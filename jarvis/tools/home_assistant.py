"""Home Assistant REST API integration tools for JARVIS.

Config is stored at ~/.jarvis/home_assistant.json:
    {"url": "http://homeassistant.local:8123", "token": "eyJ..."}

Tools exposed to the JARVIS LLM:
    ha_get_states(domain, area)       — list entity states
    ha_call_service(...)              — call any HA service
    ha_search_entities(query, domain) — search by friendly name / entity_id
    ha_get_areas(include_entities)    — list areas/rooms
    ha_render_template(template)      — render Jinja2 template
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

import aiohttp

log = logging.getLogger("jarvis.ha")

HA_CONFIG_PATH = Path.home() / ".jarvis" / "home_assistant.json"
_TIMEOUT = aiohttp.ClientTimeout(total=15)


# ── Config helpers ─────────────────────────────────────────────────────────────

def load_config() -> dict[str, str]:
    """Load HA connection config from ~/.jarvis/home_assistant.json."""
    if HA_CONFIG_PATH.exists():
        try:
            # Use utf-8-sig to handle any BOM (PowerShell writes UTF-8 BOM)
            return json.loads(HA_CONFIG_PATH.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            log.warning("HA config read error: %s", exc)
    return {}


def save_config(url: str, token: str) -> None:
    """Persist URL + token to ~/.jarvis/home_assistant.json."""
    HA_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    HA_CONFIG_PATH.write_text(
        json.dumps({"url": url.rstrip("/"), "token": token}, indent=2),
        encoding="utf-8",
    )


def _session() -> tuple[str, aiohttp.ClientSession]:
    """Return (base_url, session) or raise ValueError if not configured."""
    cfg = load_config()
    url = cfg.get("url", "").rstrip("/")
    token = cfg.get("token", "")
    if not url or not token:
        raise ValueError(
            "Home Assistant not configured. "
            "Set URL and token in Connectors → Home Assistant."
        )
    sess = aiohttp.ClientSession(
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=_TIMEOUT,
    )
    return url, sess


# ── Connection test (no stored config needed) ──────────────────────────────────

async def test_connection(url: str, token: str) -> dict[str, Any]:
    """Test a HA URL + token. Returns version/location/entity_count on success."""
    base = url.rstrip("/")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        async with aiohttp.ClientSession(headers=headers, timeout=_TIMEOUT) as s:
            # 1. Health check
            async with s.get(f"{base}/api/") as r:
                if r.status == 401:
                    return {"ok": False, "error": "Invalid or expired token (401 Unauthorized)"}
                if r.status != 200:
                    return {"ok": False, "error": f"HTTP {r.status} from HA"}
                await r.json()  # just validate JSON

            # 2. Config (version, location)
            cfg: dict[str, Any] = {}
            try:
                async with s.get(f"{base}/api/config") as r:
                    if r.status == 200:
                        cfg = await r.json()
            except Exception:
                pass

            # 3. Entity count
            entity_count = 0
            try:
                async with s.get(f"{base}/api/states") as r:
                    if r.status == 200:
                        states = await r.json()
                        entity_count = len(states)
            except Exception:
                pass

            return {
                "ok": True,
                "version": cfg.get("version", ""),
                "location": cfg.get("location_name", ""),
                "timezone": cfg.get("time_zone", ""),
                "unit_system": cfg.get("unit_system", {}).get("temperature", ""),
                "entity_count": entity_count,
            }

    except aiohttp.ClientConnectorError as exc:
        return {"ok": False, "error": f"Cannot connect: {exc}"}
    except asyncio.TimeoutError:
        return {"ok": False, "error": "Connection timed out (15 s)"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── States ─────────────────────────────────────────────────────────────────────

async def get_states(
    domain: str | None = None,
    area: str | None = None,
) -> dict[str, Any]:
    """Return entity states, optionally filtered by domain and/or area."""
    try:
        base, s = _session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    async with s:
        try:
            async with s.get(f"{base}/api/states") as r:
                r.raise_for_status()
                states: list[dict] = await r.json()
        except aiohttp.ClientResponseError as exc:
            return {"ok": False, "error": f"HA API error {exc.status}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # Domain filter
    if domain:
        states = [st for st in states if st["entity_id"].startswith(f"{domain}.")]

    # Area filter (best-effort via template)
    if area:
        try:
            area_ids = await _area_entity_ids(base, load_config().get("token", ""), area)
            if area_ids:
                area_set = set(area_ids)
                states = [st for st in states if st["entity_id"] in area_set]
        except Exception:
            pass

    summary = [
        {
            "entity_id": st["entity_id"],
            "state": st["state"],
            "friendly_name": st.get("attributes", {}).get("friendly_name", ""),
            "last_updated": st.get("last_updated", ""),
        }
        for st in states[:150]
    ]
    return {"ok": True, "count": len(states), "showing": len(summary), "states": summary}


async def get_states_for_ui(url: str, token: str) -> dict[str, Any]:
    """Fetch all states for the frontend entity browser (URL+token explicit)."""
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        async with aiohttp.ClientSession(headers=headers, timeout=_TIMEOUT) as s:
            async with s.get(f"{url.rstrip('/')}/api/states") as r:
                if r.status != 200:
                    return {"ok": False, "error": f"HTTP {r.status}"}
                states = await r.json()
        # Build domain summary + compact entity list
        domain_counts: dict[str, int] = {}
        compact = []
        for st in states:
            eid = st["entity_id"]
            dom = eid.split(".")[0]
            domain_counts[dom] = domain_counts.get(dom, 0) + 1
            compact.append({
                "entity_id": eid,
                "state": st["state"],
                "friendly_name": st.get("attributes", {}).get("friendly_name", ""),
                "domain": dom,
            })
        return {
            "ok": True,
            "count": len(states),
            "domain_counts": dict(sorted(domain_counts.items(), key=lambda x: -x[1])),
            "entities": compact,
        }
    except aiohttp.ClientConnectorError as exc:
        return {"ok": False, "error": f"Cannot connect: {exc}"}
    except asyncio.TimeoutError:
        return {"ok": False, "error": "Timed out"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Service calls ──────────────────────────────────────────────────────────────

async def call_service(
    domain: str,
    service: str,
    entity_id: str | list[str] | None = None,
    service_data: dict[str, Any] | None = None,
    area_id: str | None = None,
) -> dict[str, Any]:
    """Call any Home Assistant service."""
    try:
        base, s = _session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    payload: dict[str, Any] = {}
    if entity_id:
        payload["entity_id"] = entity_id
    if area_id:
        payload["target"] = {"area_id": area_id}
    if service_data:
        payload.update(service_data)

    async with s:
        try:
            async with s.post(f"{base}/api/services/{domain}/{service}", json=payload) as r:
                if r.status == 401:
                    return {"ok": False, "error": "Invalid or expired HA token"}
                if r.status == 404:
                    return {"ok": False, "error": f"Service {domain}.{service} not found in HA"}
                if r.status == 400:
                    body = await r.json()
                    return {"ok": False, "error": f"HA rejected request: {body.get('message', 'unknown')}"}
                r.raise_for_status()
                changed = await r.json()
                return {
                    "ok": True,
                    "service": f"{domain}.{service}",
                    "entity_id": entity_id,
                    "area_id": area_id,
                    "states_changed": len(changed) if isinstance(changed, list) else 0,
                }
        except aiohttp.ClientResponseError as exc:
            return {"ok": False, "error": f"HTTP {exc.status}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


# ── Entity search ──────────────────────────────────────────────────────────────

async def search_entities(query: str, domain: str | None = None) -> dict[str, Any]:
    """Search entities by friendly name or entity_id (case-insensitive)."""
    try:
        base, s = _session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    async with s:
        try:
            async with s.get(f"{base}/api/states") as r:
                r.raise_for_status()
                states = await r.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    q = query.lower()
    matches = []
    for st in states:
        eid = st["entity_id"]
        if domain and not eid.startswith(f"{domain}."):
            continue
        fname = st.get("attributes", {}).get("friendly_name", "")
        if q in eid.lower() or q in fname.lower():
            matches.append({
                "entity_id": eid,
                "state": st["state"],
                "friendly_name": fname,
                "domain": eid.split(".")[0],
                "unit": st.get("attributes", {}).get("unit_of_measurement", ""),
            })
    return {"ok": True, "matches": matches[:25], "total": len(matches)}


# ── Areas / rooms ──────────────────────────────────────────────────────────────

async def _area_entity_ids(base: str, token: str, area_name_or_id: str) -> list[str]:
    """Resolve area name → area ID and return its entity IDs via template."""
    tmpl = (
        "{%- set aid = area_id('" + area_name_or_id + "') or '" + area_name_or_id + "' -%}"
        "{{ area_entities(aid) | list | tojson }}"
    )
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    async with aiohttp.ClientSession(headers=headers, timeout=_TIMEOUT) as s:
        async with s.post(f"{base}/api/template", json={"template": tmpl}) as r:
            if r.status == 200:
                return json.loads(await r.text())
    return []


async def get_areas(include_entities: bool = True) -> dict[str, Any]:
    """Return all areas defined in Home Assistant, optionally with their entity IDs."""
    try:
        base, s = _session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    if include_entities:
        tmpl = (
            "{%- set ns = namespace(a=[]) -%}"
            "{%- for aid in areas() -%}"
            "{%- set ents = area_entities(aid) | list -%}"
            "{%- set ns.a = ns.a + [{'id': aid, 'name': area_name(aid),"
            " 'entity_count': ents|length, 'entities': ents}] -%}"
            "{%- endfor -%}{{ ns.a | tojson }}"
        )
    else:
        tmpl = (
            "{%- set ns = namespace(a=[]) -%}"
            "{%- for aid in areas() -%}"
            "{%- set ns.a = ns.a + [{'id': aid, 'name': area_name(aid)}] -%}"
            "{%- endfor -%}{{ ns.a | tojson }}"
        )

    async with s:
        try:
            async with s.post(f"{base}/api/template", json={"template": tmpl}) as r:
                if r.status == 200:
                    areas = json.loads(await r.text())
                    return {"ok": True, "areas": areas, "count": len(areas)}
                return {"ok": False, "error": f"Template error: HTTP {r.status}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}


async def get_areas_for_ui(url: str, token: str) -> dict[str, Any]:
    """Fetch areas for the frontend (explicit URL+token)."""
    base = url.rstrip("/")
    tmpl = (
        "{%- set ns = namespace(a=[]) -%}"
        "{%- for aid in areas() -%}"
        "{%- set ents = area_entities(aid) | list -%}"
        "{%- set ns.a = ns.a + [{'id': aid, 'name': area_name(aid),"
        " 'entity_count': ents|length}] -%}"
        "{%- endfor -%}{{ ns.a | tojson }}"
    )
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        async with aiohttp.ClientSession(headers=headers, timeout=_TIMEOUT) as s:
            async with s.post(f"{base}/api/template", json={"template": tmpl}) as r:
                if r.status == 200:
                    areas = json.loads(await r.text())
                    return {"ok": True, "areas": areas}
                return {"ok": False, "error": f"HTTP {r.status}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ── Template rendering ─────────────────────────────────────────────────────────

async def render_template(template: str) -> dict[str, Any]:
    """Render a Home Assistant Jinja2 template and return the result."""
    try:
        base, s = _session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    async with s:
        try:
            async with s.post(f"{base}/api/template", json={"template": template}) as r:
                if r.status == 200:
                    return {"ok": True, "result": await r.text()}
                body = await r.text()
                return {"ok": False, "error": f"HTTP {r.status}: {body}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
