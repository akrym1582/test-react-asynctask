# 検証結果

## CIのFirefoxエラーと修正

2026-10-31時点の失敗は、Firefoxの通常Enter送信テスト1件でした。React 18/19の単体テスト・型チェックは成功していました。

Playwright 1.58.2のFirefox用`fill()`は内部でcompositionイベントを発生させます。その直後のEnterが、変換確定の抑止対象になっていました。通常入力のテストを`pressSequentially()`へ変更し、IMEテストのイベント操作と分離しました。失敗時にレポート・トレース・スクリーンショットをActionsのArtifactsへ保存する設定も追加しています。

[修正コミット1422700のCI](https://github.com/akrym1582/test-react-asynctask/actions/runs/41191777219)では、React 18/19の両ジョブとChromium/Firefox/WebKitのブラウザージョブがすべて成功しました。ブラウザーは4ケース×3種類の12件です。

## 中心ファイルと任意部品の分離

中心の`AsyncTasks.tsx`から入力Hook・入力UI・formイベント補助へのimportおよび再exportを除きました。`useAsyncField`と`useTaskField`は`useAsyncField.ts`、UIは`TrackedInput.tsx`、form補助は`useAsyncSubmit.ts`です。

登録APIは`registerAsyncTask(key, factory, options?)`へ統一し、使用例と既存テストを更新しました。開始済みPromiseの旧形式、旧名、TrackedInputのasync onBlur形式は提供しません。

| 検証                             | 分離後のローカル実行結果                                         |
| -------------------------------- | ---------------------------------------------------------------- |
| React 19.3.1 / TypeScript 5.9.3  | 型チェック成功                                                   |
| React 19.3.1 / Vitest 3.2.7      | 39件成功                                                         |
| React 18.3.1 / @types/react 18系 | 別ディレクトリで型チェック・同じ39件・4構成のコピー検証成功      |
| Vite 6.4.5                       | 本番ビルド成功                                                   |
| コピー配布                       | 中心単独・入力Hook・入力UI・送信補助の4構成で型チェック成功      |
| 削除APIの型検証                  | 旧形式・別名・中心からの任意Hook再exportを受け付けないことを確認 |

テストでは、期限とnullによる無期限待機、取消後の遅延完了、背景処理、入力の世代切替、dirty確定、項目別エラー、動的項目の破棄、保存結果不明と照会、冪等性fake、最新値getter、IME合成イベント、保存snapshot、SSRを確認しています。無期限待機の1時間経過はfake timerで検証します。

最新コミットのCI結果は[GitHub Actions](https://github.com/akrym1582/test-react-asynctask/actions/workflows/test.yml)を参照してください。CIではReact 18/19それぞれで型・46件のテスト・4構成のコピー検証を実行し、3種類のブラウザーで操作を検証します。

## ローカル環境と別途必要な確認

この作業環境ではブラウザーZIPの取得・展開に失敗する場合があります。Firefoxの取得は代替配信元で成功しましたが、ページ作成がタイムアウトしたため、ローカルの実ブラウザー検証は未完了です。上記ブラウザーの成功結果はGitHub Actionsで確認したものです。

次の範囲は未検証です。

- Windows日本語IME、macOS日本語入力とSafari等での実OSのIME操作。合成compositionイベントのテストとは区別します。
- 実バックエンドの冪等性キー・結果照会・楽観ロック。adapterは契約例です。
- Portal/Shadow DOM、利用先の画面遷移・reset・独自入力部品との結合。

## 公開Hookの統合

`useAsyncTasks(action, options)`から`registerAsyncTask`、`runAfterTasks`、`busy`、`isResultUnknown`等を取得できる形へ統合しました。引数なしでは登録・共有状態の参照ができ、戻り値の同一性を維持します。旧Hookと旧プロパティ名は削除しています。

同じHookで登録したタスクのstate反映後に保存されること、登録専用の別コンポーネントにもbusyと保存結果不明の状態が伝わることを追加検証し、テストは41件になりました。React 19の型チェック・41件・4構成コピー検証・本番ビルドが成功しています。入力待機期限、保存期限、結果不明と照会の既存テストも新しいAPI名で実行しています。

React 18.3.1でも型チェック・同じ41件・4構成のコピー検証が成功しました。

## 自動フォーカス解除

blurActiveElementを追加し、既定で重複排除後・beforeWait前に現在のHTML要素をblurします。falseではフォーカスを維持します。サンプルの手動blurを削除し、各引数・オプションのJSDocを拡充しました。

省略時・true・falseの動作、blurからの再入、登録されたタスクのstate反映待ち、blur失敗時の通知とbusy解除を検証しています。React 18/19で各45件、型チェック・4構成のコピー検証が成功し、本番ビルドも成功しました。

## タイムアウトの既定値

入力タスク・総待機・保存の3種類をすべて既定null（無期限）へ変更しました。Providerの期限指定を省略した例へ更新し、コメント・README・AGENTS.mdも揃えています。

期限指定なしの入力待機と保存で各1時間経過してもタイムアウトしないこと、有限期限を設定したProviderに対する個別null上書き、既存の有限期限時の取消・結果不明処理を確認しました。React 18/19で各46件、型・4構成コピー検証、本番ビルドが成功しています。

## ESLint・Prettier

ESLint 10とtypescript-eslintの推奨ルール、React Hooksの呼び出し順序・依存配列検査を導入しました。SSR用useCommitEffectも依存検査の対象です。Prettierでソース・設定・Markdownを整形し、ESLintと競合する整形ルールはeslint-config-prettierで調整しています。

Effectから参照するfail/prepareをuseCallbackで安定させて依存配列へ追加し、テストのanyをActionContextに置き換えました。lint（警告0件）、整形チェック、型チェック、46件のテスト、4構成のコピー配布検証、本番ビルドが成功しました。CIのReact 18/19両ジョブにもlint・整形チェックを追加しています。

## テスト構成の整理

単体テストをsrcのファイル名に対応する5ファイルへ整理し、結合テストはtests/integration/の3ファイルへ移しました。合計46件（単体35件、結合11件）を維持しています。整理後もlint・整形チェック・型チェック・全46件・4構成コピー検証・本番ビルドが成功しています。

## テストケースの日本語説明

単体・結合・ブラウザーテストの各ケースに「確認する状況」と「期待する結果」を追記し、テスト名・グループ名も日本語へ揃えました。期限や自動blurのパラメーターによる違い、遅い結果の破棄、保存結果不明の回復条件、合成IME・fake adapterの検証範囲を説明しています。

変更後もlint・整形チェック・46件のテストが成功し、ブラウザー12件の列挙を確認しました。TypeScriptの構文木を比較し、9ファイルのテスト本体がテスト名・コメントを除いて同一であることも確認しています。
