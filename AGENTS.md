# このリポジトリで作業するエージェントへ

## 目的

React / TypeScriptで、非同期の入力処理を待った後、最新のcommit済みstateを参照する保存処理を実行するためのサンプル・配布用コードです。共通Buttonの利用や、フォームstateをrefへコピーする作業を利用者へ要求しません。

## ファイル構成と依存の方向

- `src/AfterTasks.tsx`が中心ファイルです。Context、タスク登録・待機、任意機能を待機へ接続する内部契約、`useAfterTasks`を持ちます。React以外の実行時importを追加しないでください。この1ファイルだけで利用できることを維持します。
- `src/useAfterTasksField.ts`は任意の入力Hook群です。`useAfterTasksField`、`useAfterTasksFieldState`、`AfterTasksFieldOptions`をまとめます。中心ファイルと`useLatestCommitted.ts`に依存し、入力の世代・dirty・エラー状態の管理本体もここに置きます。
- `src/useLatestCommitted.ts`は任意の最新commit値getterです。Reactだけに依存し、Providerなしで単独利用できます。中心ファイルは公開getterを参照せず、オプション参照用のprivate helperを持ちます。
- `src/AfterTasksInput.tsx`は任意の入力UIです。`useAfterTasksField.ts`を利用し、確定処理を重複実装しません。
- `src/useAfterTasksSubmit.ts`は任意のformイベント補助です。IME・Enter・明示クリックを扱い、タスク管理には依存しません。
- 中心ファイルから任意部品をimport・再exportしないでください。利用例は必要なファイルから明示的にimportします。
- コピー対象を増減したら、READMEの構成表と`scripts/check-copy.mjs`も更新します。

## APIの方針

- 機能名・中心ファイル・Provider・Hook・公開型は`AfterTasks`へ統一します。旧`AsyncTasks`系の別名・再exportは追加しません。`registerAsyncTask`・`runAfterTasks`・`isRunning`・`hasPendingTasks`と汎用の`useLatestCommitted`はそのまま使います。

- 実行中の状態名は`isRunning`、未完了の登録タスクがある状態名は`hasPendingTasks`です。旧名`busy`・`taskBusy`の互換プロパティは提供しません。

- 公開Hookは`useAfterTasks`に統一します。引数なしは登録・共有状態参照用、actionとoptionsを指定した場合は`runAfterTasks`も返します。登録用呼び出しの戻り値の同一性を保ち、任意の入力Hookを不要に再mountさせないでください。
- 実行名は`runAfterTasks`です。保存結果の分類・照会・再送判断はAPI呼び出し側で行います。`isResultUnknown`・`reconcile`・`UncertainActionError`は共通部品へ戻さないでください。`useAsyncTasks`・`run`・`blocked`の互換APIは提供しません。

- タスクの登録は`registerAsyncTask(factory, options?)`に一本化します。key省略時はUUIDを自動生成し、各登録を独立してすべて待機します。固定keyはoptions.keyで指定し、指定した場合だけ同じkeyの前の処理を置き換えます。factoryは`{ signal }`を受け取り、結果を返します。state反映は同期的な`options.onCommit`へ分けます。
- 旧APIの互換性は維持しません。開始済みPromiseを直接渡す形式、`register`/`track`の別名、AfterTasksInputのasync `onBlur`形式、削除したexportを復活させないでください。
- `AfterTasksInput`は`normalize`と`onCommit`が必須です。`useAfterTasksField`の無効化用null形式は不要です。動的入力は子コンポーネントのmount/unmountで扱います。
- `runAfterTasks`はイベントハンドラーとして使うvoid関数です。`await runAfterTasks()`で保存終了を待てると説明しないでください。成功後の処理はaction内へ書きます。
- 3種類のタイムアウトはすべて既定で`null`（無期限）です。タイムアウトの`null`は無期限、`undefined`は既定値を継承します。0・負数・NaN・Infinityは無効です。無期限でも取消とunmountの後始末は必要です。

- `blurActiveElement`の既定値はtrueです。重複排除後、beforeWaitより前に現在のHTML要素をblurします。falseはフォーカスを維持します。SSRではdocumentを参照せず、対象がProviderのDOM範囲に限定されない点を説明してください。

- `hasPendingTasks`はpendingの登録タスクが1件以上ある状態です。背景処理も含めて全子孫へ共有し、dirty入力や保存actionだけの実行は含めません。`isRunning`は保存要求の待機・実行中を示します。blur直後のclickを妨げないよう保存ボタンの無効化にhasPendingTasksを使わないでください。

## 保持すべき動作

- 単純なPromise待機だけでは古いclosureは更新されません。タスク完了後に再レンダーし、そのレンダーに対応するactionを呼びます。
- 入力の再編集、取消、期限切れ、unmount、同じkeyでの再登録後は、古い結果をonCommitへ渡しません。
- 待機中に追加されたタスクとdirty入力も保存前に確認します。
- 保存要求の重複をProvider単位で防ぎます。actionの成功・失敗後にisRunningを解除します。保存期限ではsignalで中断要求とonError通知を行い、元actionの終了まではisRunningを維持します。API側でcatch済みなら共通側は再通知しません。
- React 18.3/19、StrictMode、SSRに対応します。破棄されたレンダーの値をlatest getterから公開しません。
- SyntheticEventの必要な値はイベント中に取得し、preventDefaultも同期的に実行します。
- FirefoxのPlaywright `fill()`はcompositionイベントを発生させるため、通常のキー入力を検証するケースは`pressSequentially()`を使います。IMEケースは分けます。合成イベントを実OSの日本語IME検証済みとは扱いません。

## コメントと使用例

- コメントとREADMEは初心者向けの日本語で書きます。「何をするか」だけでなく、「なぜ必要か」「呼び出すタイミング」も説明します。
- useAfterTasksExecutionの戻り値は全項目を明示し、型定義・returnの各プロパティに役割・状態変化・用途を説明してください。
- 公開Hook・APIにはJSDocの使用例を付け、正しいimport先、同期/非同期の境界、nullの意味を示します。
- 削除したAPIの使用例・移行用コードを残しません。説明・サンプル・テストを現在のAPIへ揃えます。
- 利用者の画面に共通処理の内部実装を露出させません。

## Lintと整形

ESLintの設定は`eslint.config.js`、Prettierは`.prettierrc.json`です。変更後は`npm run format`で整形し、`npm run lint`と`npm run format:check`を実行します。React Hooksの呼び出し順と依存配列は、SSR用の`useCommitEffect`も含めて検証します。指摘を消すための一括ルール無効化は避け、必要な依存・型を修正してください。

## テストの構成

単体テストはsrcと同じ相対パス・名前を使い、tests/へ配置します（src/useAfterTasksField.ts → tests/useAfterTasksField.test.tsx）。将来srcにサブディレクトリを設ける場合も対応させます。複数部品を組み合わせる結合テストはtests/integration/へ配置し、実ブラウザーの結合テストはbrowser-tests/に置きます。ヘルパーはtests/helpers.ts等にまとめます。サンプルのためだけに空のテストファイルを作る必要はありません。既存の検証を移す際はテスト数・検証内容を維持してください。

各テストケースの名前は日本語で書き、直前のコメントに「確認する状況」と「期待する結果」を具体的に記載してください。パラメーター化したテストでは設定ごとの差を説明します。実OSのIMEと合成イベント、メモリ上のadapterと実サーバーのように検証範囲が異なるものは、その範囲も明記します。

## 検証

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run check:copy
npm run build
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
```

CIはReact 18/19で型・単体・コピー検証を行い、Chromium/Firefox/WebKitでブラウザー操作を確認します。変更後は関連する検証を実行し、pushを依頼されている作業では最新コミットのCI結果まで確認します。

`check:copy`は中心ファイル単独、入力Hook、入力UI、getter単独、送信補助の5構成を、他のsrcファイルをコピーせずに検証します。ブラウザーテスト失敗時はActionsの`playwright-failure-report`を確認できます。

未実行・起動失敗・実行中の検証を成功と報告しないでください。`VERIFICATION.md`には実際に確認した範囲と制約を記録します。CIを通すためにテストをskipしたり、検証対象の動作を削除したりしないでください。
