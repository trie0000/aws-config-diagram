/**
 * App.tsx: AWS Config Diagram Generator - メインアプリケーション
 *
 * 2画面構成のルーティング:
 * - DiagramState なし → StartScreen（アップロード + ステップ説明）
 * - DiagramState あり → EditorScreen（ツールバー + Canvas + サイドバー）
 *
 * Version: 4.0.0
 * Last Updated: 2026-02-14
 */

import { useDiagram } from './hooks/useDiagram'
import { StartScreen } from './components/StartScreen'
import { EditorScreen } from './components/EditorScreen'

function App() {
  const diagram = useDiagram()

  if (diagram.state) {
    return <EditorScreen diagram={diagram} />
  }

  return <StartScreen diagram={diagram} />
}

export default App
