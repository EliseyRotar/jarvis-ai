import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

export function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="resp-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

export function LiveResponse({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap">
      {text}
      <span className="hud-caret" />
    </span>
  )
}
