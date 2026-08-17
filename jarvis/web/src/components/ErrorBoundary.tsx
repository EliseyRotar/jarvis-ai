import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
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
