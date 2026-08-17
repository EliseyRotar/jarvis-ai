"""Home Assistant REST API integration tools for JARVIS.

Config is stored at ~/.jarvis/home_assistant.json:
    {"url": "http://homeassistant.local:8123", "token": "eyJ..."}

Performance architecture:
    1. Single persistent aiohttp.ClientSession + TCPConnector (keep-alive).
       Eliminates TCP handshake overhead (~30-150 ms) on every tool call.
    2. 5-second state cache.  Chained LLM calls (search → call_service) reuse
       the cached payload instead of downloading 373 entities twice.
       Cache is invalidated immediately after any call_service call.
    3. Template-based domain filtering.  get_states(domain='light') asks HA
       to return only light entities via /api/template — no full-list download.
    4. Parallel requests in test_connection (asyncio.gather).
    5. All helpers share the single persistent session; no stray sessions.

Tools exposed to the JARVIS LLM:
    ha_get_states(domain, area)       — list entity states
    ha_call_service(...)              — control any device
    ha_search_entities(query, domain) — search by name / entity_id
    ha_get_areas(include_entities)    — list rooms
    ha_render_template(template)      — run Jinja2 on HA
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

import aiohttp

log = logging.getLogger("jarvis.ha")

HA_CONFIG_PATH = Path.home() / ".jarvis" / "home_assistant.json"

# Liberal timeout — service calls can take up to ~5 s for slow devices.
_TIMEOUT = aiohttp.ClientTimeout(connect=5, total=15)

# ── Persistent session pool ────────────────────────────────────────────────────
# One shared session across all tool calls so TCP connections are reused.
# Re-created only when URL/token changes.

_session: aiohttp.ClientSession | None = None
_connector: aiohttp.TCPConnector | None = None
_session_fingerprint: str = ""   # "url|token_prefix" — detects config changes


def _cfg_fingerprint(url: str, token: str) -> str:
    return f"{url}|{token[:12]}"


async def _get_session() -> tuple[str, aiohttp.ClientSession]:
    """Return (base_url, shared_session). Creates/recreates if config changed."""
    global _session, _connector, _session_fingerprint

    cfg = load_config()
    url = cfg.get("url", "").rstrip("/")
    token = cfg.get("token", "")
    if not url or not token:
        raise ValueError(
            "Home Assistant not configured. "
            "Set URL and token in Connectors → Home Assistant."
        )

    fp = _cfg_fingerprint(url, token)
    if _session is None or _session.closed or fp != _session_fingerprint:
        # Close old session/connector cleanly
        if _session and not _session.closed:
            await _session.close()
        if _connector and not _connector.closed:
            await _connector.close()

        _connector = aiohttp.TCPConnector(
            limit=6,               # max concurrent connections to HA
            keepalive_timeout=30,  # seconds — keep TCP alive between calls
            enable_cleanup_closed=True,
        )
        _session = aiohttp.ClientSession(
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=_TIMEOUT,
            connector=_connector,
            connector_owner=False,  # we manage the connector lifetime
        )
        _session_fingerprint = fp
        log.debug("HA: new persistent session created for %s", url)

    return url, _session


# ── State cache ────────────────────────────────────────────────────────────────
# Avoids re-downloading 373 entities on every chained LLM tool call.
# Invalidated immediately after any call_service (state has changed).

_states_cache: list[dict] | None = None
_states_cache_ts: float = 0.0
_STATES_TTL: float = 5.0   # seconds


def _invalidate_cache() -> None:
    global _states_cache, _states_cache_ts
    _states_cache = None
    _states_cache_ts = 0.0


async def _fetch_all_states(base: str, s: aiohttp.ClientSession) -> list[dict]:
    """Fetch /api/states with a 5-second cache."""
    global _states_cache, _states_cache_ts
    now = time.monotonic()
    if _states_cache is not None and (now - _states_cache_ts) < _STATES_TTL:
        log.debug("HA: states cache hit (%.1f s old)", now - _states_cache_ts)
        return _states_cache
    async with s.get(f"{base}/api/states") as r:
        r.raise_for_status()
        states: list[dict] = await r.json(content_type=None)
    _states_cache = states
    _states_cache_ts = time.monotonic()
    log.debug("HA: fetched %d states from API", len(states))
    return states


# ── Config helpers ─────────────────────────────────────────────────────────────

def load_config() -> dict[str, str]:
    """Load HA connection config from ~/.jarvis/home_assistant.json."""
    if HA_CONFIG_PATH.exists():
        try:
            # utf-8-sig strips BOM written by PowerShell
            return json.loads(HA_CONFIG_PATH.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            log.warning("HA config read error: %s", exc)
    return {}


def save_config(url: str, token: str) -> None:
    """Persist URL + token and reset the session so it reconnects."""
    HA_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    HA_CONFIG_PATH.write_text(
        json.dumps({"url": url.rstrip("/"), "token": token}, indent=2),
        encoding="utf-8",
    )
    # Force session recreation on next call
    global _session_fingerprint
    _session_fingerprint = ""
    _invalidate_cache()


# ── Connection test ────────────────────────────────────────────────────────────

async def test_connection(url: str, token: str) -> dict[str, Any]:
    """Test a HA URL+token.  Fires /api/, /api/config and /api/states in parallel."""
    base = url.rstrip("/")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    conn = aiohttp.TCPConnector(limit=3)
    try:
        async with aiohttp.ClientSession(headers=headers, timeout=_TIMEOUT,
                                         connector=conn) as s:
            # Quick auth probe first (fail-fast on bad token)
            async with s.get(f"{base}/api/") as r:
                if r.status == 401:
                    return {"ok": False, "error": "Invalid or expired token (401)"}
                if r.status != 200:
                    return {"ok": False, "error": f"HTTP {r.status} from HA"}

            # Fetch config + entity count IN PARALLEL
            async def _get_cfg() -> dict:
                async with s.get(f"{base}/api/config") as r:
                    return await r.json(content_type=None) if r.status == 200 else {}

            async def _count_states() -> int:
                async with s.get(f"{base}/api/states") as r:
                    if r.status != 200:
                        return 0
                    data = await r.json(content_type=None)
                    return len(data)

            cfg, entity_count = await asyncio.gather(_get_cfg(), _count_states())

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
    finally:
        await conn.close()


# ── States ─────────────────────────────────────────────────────────────────────

_DOMAIN_TMPL = (
    "{%- set ns = namespace(out=[]) -%}"
    "{%- for s in states.DOMAIN -%}"
    "{%- set ns.out = ns.out + [{'entity_id': s.entity_id, 'state': s.state,"
    " 'friendly_name': s.attributes.get('friendly_name', ''),"
    " 'last_updated': s.last_updated | string}] -%}"
    "{%- endfor -%}{{ ns.out | tojson }}"
)


async def get_states(
    domain: str | None = None,
    area: str | None = None,
) -> dict[str, Any]:
    """Return entity states, filtered by domain and/or area.

    When domain is given, uses /api/template to avoid downloading all entities.
    When area is given, resolves entities via template in parallel with states fetch.
    """
    try:
        base, s = await _get_session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    try:
        if domain and not area:
            # Template path: only download the requested domain — much smaller payload
            tmpl = _DOMAIN_TMPL.replace("DOMAIN", domain)
            async with s.post(f"{base}/api/template", json={"template": tmpl}) as r:
                if r.status != 200:
                    # Fall through to full fetch on template error
                    states = await _fetch_all_states(base, s)
                    states = [st for st in states if st["entity_id"].startswith(f"{domain}.")]
                else:
                    text = await r.text()
                    states = json.loads(text)
        elif domain and area:
            # Need both filters — run state fetch + area lookup in parallel
            states_coro = _fetch_all_states(base, s)
            area_coro = _resolve_area_entities(base, s, area)
            states, area_ids = await asyncio.gather(states_coro, area_coro)
            area_set = set(area_ids)
            states = [
                st for st in states
                if st["entity_id"].startswith(f"{domain}.")
                and st["entity_id"] in area_set
            ]
        elif area:
            # Area filter only — parallel fetch + area resolve
            states_coro = _fetch_all_states(base, s)
            area_coro = _resolve_area_entities(base, s, area)
            states, area_ids = await asyncio.gather(states_coro, area_coro)
            area_set = set(area_ids)
            states = [st for st in states if st["entity_id"] in area_set]
        else:
            states = await _fetch_all_states(base, s)

        summary = [
            {
                "entity_id": st["entity_id"],
                "state": st["state"],
                "friendly_name": st.get("attributes", {}).get(
                    "friendly_name", st.get("friendly_name", "")
                ),
                "last_updated": st.get("last_updated", ""),
            }
            for st in states[:150]
        ]
        return {"ok": True, "count": len(states), "showing": len(summary), "states": summary}

    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def get_states_for_ui(url: str, token: str) -> dict[str, Any]:
    """Fetch all states for the frontend entity browser."""
    # UI calls pass explicit url/token, bypass persistent session
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    conn = aiohttp.TCPConnector(limit=2)
    try:
        async with aiohttp.ClientSession(headers=headers, timeout=_TIMEOUT,
                                         connector=conn) as s:
            async with s.get(f"{url.rstrip('/')}/api/states") as r:
                if r.status != 200:
                    return {"ok": False, "error": f"HTTP {r.status}"}
                states = await r.json(content_type=None)
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
    finally:
        await conn.close()


# ── Service calls ──────────────────────────────────────────────────────────────

async def call_service(
    domain: str,
    service: str,
    entity_id: str | list[str] | None = None,
    service_data: dict[str, Any] | None = None,
    area_id: str | None = None,
) -> dict[str, Any]:
    """Call any Home Assistant service.  Invalidates state cache on success."""
    try:
        base, s = await _get_session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    payload: dict[str, Any] = {}
    if entity_id:
        payload["entity_id"] = entity_id
    if area_id:
        payload["target"] = {"area_id": area_id}
    if service_data:
        payload.update(service_data)

    try:
        async with s.post(f"{base}/api/services/{domain}/{service}", json=payload) as r:
            if r.status == 401:
                return {"ok": False, "error": "Invalid or expired HA token"}
            if r.status == 404:
                return {"ok": False, "error": f"Service {domain}.{service} not found in HA"}
            if r.status == 400:
                body = await r.json(content_type=None)
                return {"ok": False, "error": f"HA rejected: {body.get('message', 'unknown')}"}
            r.raise_for_status()
            changed = await r.json(content_type=None)
            _invalidate_cache()   # state changed — bust the cache
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
    """Search entities by friendly name or entity_id.  Uses cache when warm."""
    try:
        base, s = await _get_session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    try:
        states = await _fetch_all_states(base, s)
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

async def _resolve_area_entities(
    base: str, s: aiohttp.ClientSession, area_name_or_id: str
) -> list[str]:
    """Return entity IDs in an area via /api/template (shared session)."""
    tmpl = (
        "{%- set aid = area_id('" + area_name_or_id + "') or '"
        + area_name_or_id + "' -%}"
        "{{ area_entities(aid) | list | tojson }}"
    )
    async with s.post(f"{base}/api/template", json={"template": tmpl}) as r:
        if r.status == 200:
            return json.loads(await r.text())
    return []


async def get_areas(include_entities: bool = True) -> dict[str, Any]:
    """Return all areas defined in Home Assistant."""
    try:
        base, s = await _get_session()
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

    try:
        async with s.post(f"{base}/api/template", json={"template": tmpl}) as r:
            if r.status == 200:
                areas = json.loads(await r.text())
                return {"ok": True, "areas": areas, "count": len(areas)}
            return {"ok": False, "error": f"Template error: HTTP {r.status}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def get_areas_for_ui(url: str, token: str) -> dict[str, Any]:
    """Fetch areas for the frontend (explicit url/token, own session)."""
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
    conn = aiohttp.TCPConnector(limit=2)
    try:
        async with aiohttp.ClientSession(headers=headers, timeout=_TIMEOUT,
                                         connector=conn) as s:
            async with s.post(f"{base}/api/template", json={"template": tmpl}) as r:
                if r.status == 200:
                    areas = json.loads(await r.text())
                    return {"ok": True, "areas": areas}
                return {"ok": False, "error": f"HTTP {r.status}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        await conn.close()


# ── Template rendering ─────────────────────────────────────────────────────────

async def render_template(template: str) -> dict[str, Any]:
    """Render a Home Assistant Jinja2 template and return the result."""
    try:
        base, s = await _get_session()
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    try:
        async with s.post(f"{base}/api/template", json={"template": template}) as r:
            if r.status == 200:
                return {"ok": True, "result": await r.text()}
            body = await r.text()
            return {"ok": False, "error": f"HTTP {r.status}: {body}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
