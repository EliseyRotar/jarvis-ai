import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Compact mode — used inside panels / widgets so a single crash is
   *  contained instead of tearing down the whole orb UI. */
  compact?: boolean
  /** Optional label shown in compact error state. */
  label?: string
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('App crashed:', error, info)
  }

  render() {
    if (this.state.error) {
      if (this.props.compact) {
        return (
          <div className="flex h-full w-full items-center justify-center rounded border border-[var(--line-bright)] bg-black/40 p-3 font-mono text-[10px] leading-snug text-[var(--red)]">
            <div className="space-y-1">
              <div className="uppercase tracking-[0.2em] text-[var(--red)]">
                {this.props.label || 'widget'} error
              </div>
              <div className="text-[var(--text-dim)]">{this.state.error.message}</div>
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="mt-1 rounded-sm border border-[var(--line-bright)] px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
              >
                retry
              </button>
            </div>
          </div>
        )
      }
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-black p-10 font-mono text-[var(--text)]">
          <div className="text-[14px] uppercase tracking-[0.24em] text-[var(--red)]">
            cosmo crashed
          </div>
          <pre className="mt-3 max-w-2xl whitespace-pre-wrap break-words rounded-sm border border-[var(--line)] bg-black/50 p-4 text-[11px] text-[var(--text-dim)]">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-sm border border-[var(--line-bright)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
          >
            retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
