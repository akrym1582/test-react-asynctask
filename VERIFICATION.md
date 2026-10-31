# 検証結果

- TypeScript: `npm run typecheck` 成功
- React 19.3.1 / StrictMode / jsdom
- Vitest: `npm test`、13件成功

対象: 待機中の追加タスク、失敗の保持と項目ごとの再試行、Scopeロック、最新stateでの1回実行、保存中busy、入力失敗、待機中アンマウント、保存失敗、フォーカス解除を伴うsubmit。

追加検証: 同一keyの古い失敗の無効化、commit中に追加されるタスク、複数Hook間の同時run抑止、beforeWaitの同期例外、Provider間の独立性。

React 18での実行検証、および実ブラウザーでのポインター・キーボード・IME操作の検証は未実施です。組み込み先のアプリでも確認してください。
