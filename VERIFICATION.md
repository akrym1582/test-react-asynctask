# 検証結果

## CIのFirefoxエラーと修正

2026-10-31時点の失敗は、Firefoxの通常Enter送信テスト1件でした。React 18/19の単体テスト・型チェックは成功していました。

Playwright 1.58.2のFirefox用`fill()`は内部でcompositionイベントを発生させます。その直後のEnterが、変換確定の抑止対象になっていました。通常入力のテストを`pressSequentially()`へ変更し、IMEテストのイベント操作と分離しました。失敗時にレポート・トレース・スクリーンショットをActionsのArtifactsへ保存する設定も追加しています。

[修正コミット1422700のCI](https://github.com/akrym1582/test-react-asynctask/actions/runs/41191777219)では、React 18/19の両ジョブとChromium/Firefox/WebKitのブラウザージョブがすべて成功しました。ブラウザーは4ケース×3種類の12件です。

## 中心ファイルと任意部品の分離

中心の`AsyncTasks.tsx`から入力Hook・入力UI・formイベント補助へのimportおよび再exportを除きました。`useAsyncField`と`useTaskField`は`useAsyncField.ts`、UIは`TrackedInput.tsx`、form補助は`useAsyncSubmit.ts`です。

登録APIは`registerAsyncTask(key, factory, options?)`へ統一し、使用例と既存テストを更新しました。開始済みPromiseの旧形式、旧名、TrackedInputのasync onBlur形式は提供しません。

| 検証 | 分離後のローカル実行結果 |
| --- | --- |
| React 19.3.1 / TypeScript 5.9.3 | 型チェック成功 |
| React 19.3.1 / Vitest 3.2.7 | 39件成功 |
| React 18.3.1 / @types/react 18系 | 別ディレクトリで型チェック・同じ39件・4構成のコピー検証成功 |
| Vite 6.4.5 | 本番ビルド成功 |
| コピー配布 | 中心単独・入力Hook・入力UI・送信補助の4構成で型チェック成功 |
| 削除APIの型検証 | 旧形式・別名・中心からの任意Hook再exportを受け付けないことを確認 |

テストでは、期限とnullによる無期限待機、取消後の遅延完了、背景処理、入力の世代切替、dirty確定、項目別エラー、動的項目の破棄、保存結果不明と照会、冪等性fake、最新値getter、IME合成イベント、保存snapshot、SSRを確認しています。無期限待機の1時間経過はfake timerで検証します。

最新コミットのCI結果は[GitHub Actions](https://github.com/akrym1582/test-react-asynctask/actions/workflows/test.yml)を参照してください。CIではReact 18/19それぞれで型・39件のテスト・4構成のコピー検証を実行し、3種類のブラウザーで操作を検証します。

## ローカル環境と別途必要な確認

この作業環境ではブラウザーZIPの取得・展開に失敗する場合があります。Firefoxの取得は代替配信元で成功しましたが、ページ作成がタイムアウトしたため、ローカルの実ブラウザー検証は未完了です。上記ブラウザーの成功結果はGitHub Actionsで確認したものです。

次の範囲は未検証です。

- Windows日本語IME、macOS日本語入力とSafari等での実OSのIME操作。合成compositionイベントのテストとは区別します。
- 実バックエンドの冪等性キー・結果照会・楽観ロック。adapterは契約例です。
- Portal/Shadow DOM、利用先の画面遷移・reset・独自入力部品との結合。
