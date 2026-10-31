# 検証結果

## 実行済み

| 対象                             | 結果                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| React 19.3.1 / TypeScript 5.9.3  | `npm run typecheck` 成功                                                                             |
| React 19.3.1 / Vitest 3.2.7      | `npm test` 39件成功                                                                                  |
| React 18.3.1 / @types/react 18系 | 別ディレクトリでインストールし、型チェック・同じ39件のテスト成功                                     |
| 1ファイル配布                    | `npm run check:copy` 成功。AsyncTasks.tsxだけをコピーして型チェック                                  |
| SSR                              | node環境でrenderToStringし、window/document参照エラー・layout effect警告・action開始がないことを確認 |
| ブラウザーのテスト定義           | Playwright 1.58.2で12件（4ケース×3ブラウザー）を列挙できることを確認                                 |

既存13件に加え、期限、cancel後の遅延完了、背景処理、編集時点の世代切替、dirty確定、項目別エラー、動的項目の破棄、即時エラー表示、保存結果不明と照会、冪等性fake、latest getterと未commit値、IME合成イベント、総待機期限、snapshot、SSRを検証しました。

デモ画面のVite 6.4.5本番ビルド（`npx vite build`）も成功しました。

## 実ブラウザー実行の制約

この実行環境ではPlaywrightのブラウザーZIPの取得結果を展開できず、`End of central directory record signature not found`でインストールが失敗しました。Chromiumテストの実行もブラウザー実行ファイル不足で起動前に停止しました。システムのChromiumもありません。

そのためChromium/Firefox/WebKitの実操作テストはこの環境では**未完了**です。テスト成功とは扱っていません。`.github/workflows/test.yml`にブラウザー導入・12件実行のジョブを用意しています。CIの実行結果はGitHub Actionsで確認してください。

## 別途必要な確認

- Windowsの日本語IME、macOS日本語入力とSafari等での実IME操作。合成compositionイベントのテストと同一視しないでください。
- 実バックエンドの冪等性キー・結果照会・楽観ロック。adapterは契約例であり、本物のサーバーを作成・検証したものではありません。
- Portal/Shadow DOM、利用先の画面遷移・reset・独自入力部品との結合。

単体テストの成功は、上記の未実施範囲まで保証するものではありません。

追加で、null指定による入力・総待機・保存の無期限待機、個別期限の上書き、registerの無期限待機、通常input + useAsyncFieldの古い結果破棄を確認しました。テストの1時間経過はfake timerで再現しています。

TrackedInput分離後もReact 18/19で各39件、型チェック、コピー検証、本番ビルドが成功しました。AsyncTasks.tsxはTrackedInput.tsxを参照せず、単独コピー可能です。TrackedInputの利用側importは専用ファイルへ更新しています。
