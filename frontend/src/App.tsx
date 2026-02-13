/**
 * App.tsx: AWS Config Diagram Generator - メインアプリケーション
 *
 * Phase 1.5 MVP: Config JSON → SVG構成図表示・編集
 */

function App() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* ツールバー */}
      <header className="flex h-12 items-center border-b px-4">
        <h1 className="text-lg font-semibold">AWS Config Diagram</h1>
      </header>

      {/* メインエリア */}
      <main className="flex flex-1 overflow-hidden">
        {/* SVG Canvas エリア（将来実装） */}
        <div className="flex flex-1 items-center justify-center bg-muted/30">
          <p className="text-muted-foreground">
            Config JSON をアップロードして構成図を生成
          </p>
        </div>

        {/* 右パネル（将来実装: リソース詳細） */}
      </main>
    </div>
  )
}

export default App
