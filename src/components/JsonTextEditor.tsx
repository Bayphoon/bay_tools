import Editor from '@monaco-editor/react'

export function JsonTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Editor
    height="100%"
    language="json"
    value={value}
    onChange={(nextValue) => onChange(nextValue ?? '')}
    theme="vs-dark"
    options={{
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      automaticLayout: true,
      folding: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      formatOnPaste: false,
    }}
  />
}
