# React AfterTasks

非同期blurで入力を確定してから、最新のレンダーのstateで保存するための共通処理です。
**中心の`src/AfterTasks.tsx`だけで、Context・タスク登録・完了待機・保存を利用できます。** 入力HookやUI、form送信の補助は任意ファイルです。React以外の実行時依存はありません。

## 必要なファイルだけコピーする

| 利用する機能                                           | コピーするファイル                                       |
| ------------------------------------------------------ | -------------------------------------------------------- |
| タスク登録・待機後のイベント実行                       | `AfterTasks.tsx`だけ                                     |
| 入力の自動確定・再編集時の古い結果の破棄・項目状態表示 | 上記 + `useLatestCommitted.ts` + `useAfterTasksField.ts` |
| 入力UIも共通化する                                     | 入力Hookの3ファイル + `AfterTasksInput.tsx`              |
| 最新commit済み値のgetterだけを利用する                 | `useLatestCommitted.ts`だけ（Provider不要）              |
| formのIME・Enter送信を補助する                         | 必要に応じて`useAfterTasksSubmit.ts`を追加               |

```tsx
// 必須の中心ファイル
import { AfterTasksProvider, useAfterTasks } from "./AfterTasks";
// 以下は利用するものだけimportします。
import { useAfterTasksField } from "./useAfterTasksField";
import { useAfterTasksFieldState } from "./useAfterTasksField";
import { AfterTasksInput } from "./AfterTasksInput";
import { useAfterTasksSubmit } from "./useAfterTasksSubmit";
import { useLatestCommitted } from "./useLatestCommitted";
```

中心ファイルから任意ファイルをimport・再exportしません。中心側は任意機能の準備・待機判定・破棄を呼び出す汎用の接続だけを持ちます。入力の世代・dirty・エラー表示の管理本体はuseAfterTasksField.tsへ集約しています。任意HookのコードやUIファイルを配布先へ持ち込む必要はありません。

引数なしの`useAfterTasks()`はタスク登録と共有状態の参照に使えます。保存処理と`onError`を渡すと、`runAfterTasks`も取得できます。保存処理はHookの引数として定義し、クリック時には`onClick={runAfterTasks}`で実行します。

`isRunning`は保存要求後の入力待機・保存中、`hasPendingTasks`は登録タスクの実行中を示します。保存失敗はonErrorへ通知し、処理終了時にisRunningを解除します。APIのエラー表示や再送判断は呼び出し側で扱います。

## 無期限で待つ設定

入力タスク・総待機・保存の3種類は、**デフォルトで無期限**です。Providerには期限を指定せず使えます。

```tsx
<AfterTasksProvider>
  <EditForm />
</AfterTasksProvider>
```

Providerの期限は省略時null（無期限）です。Hookやタスクの期限を省略（undefined）するとProviderの設定を継承し、nullを指定するとProviderが有限期限でも無期限に上書きします。`Infinity`や0は使いません。`useAfterTasks`の`waitTimeoutMs`/`actionTimeoutMs`、`registerAsyncTask`/`useAfterTasksField`の`timeoutMs`で個別上書きできます。外部APIやサーバー自体の期限が延びるわけではありません。

未完了の処理がある間はisRunningが継続します。`null`は期限だけを無効化し、cancelやunmount時の後始末は無効化しません。

## 中心ファイルだけで使う

通常のinputのblurからタスクを登録できます。`src/PlainBlurExample.tsx`に、Providerとエラー表示を含めた例があります。HookはProviderの子コンポーネントで使います。

```tsx
const { registerAsyncTask, runAfterTasks, isRunning } = useAfterTasks(async context => {
  await save({ name }, context);
}, {
  blurActiveElement: true, // 省略時もtrue。onBlurからタスクを登録させる
  onError: error => setError(String(error)),
});

<input value={name} readOnly={isRunning}
  onChange={event => setName(event.currentTarget.value)}
  onBlur={event => {
    const input = event.currentTarget.value; // イベントの値は同期的に取得
    registerAsyncTask(({ signal }) => normalizeName(input, { signal }), {
      onCommit: setName, // 有効な最新の結果だけをstateへ反映
    });
  }}
/>
<button type="button" onClick={runAfterTasks} disabled={isRunning}>保存</button>
```

非同期関数は結果を返し、state更新は`onCommit`へ分けます。key省略時は登録ごとにUUIDを自動生成し、すべての処理を独立して待ちます。必要な場合だけoptions.keyで固定keyを指定でき、同じkeyの再登録時には古い結果を破棄します。次のblurより前の再編集でも古い結果を破棄したい場合は、次の入力Hookを追加します。

## 任意の入力Hookを使う

`useAfterTasksField`を使えば、DOMは通常のinputや既存UIライブラリーの部品を使えます。`useAfterTasksFieldState`は同じファイルにある状態表示用Hookです。

```tsx
import { useAfterTasksField } from "./useAfterTasksField";
import { useAfterTasksFieldState } from "./useAfterTasksField";

const [name, setName] = useState("");
const nameField = useAfterTasksField({
  taskKey: "name", value: name,
  normalize: (input, { signal }) => normalizeName(input, { signal }),
  onCommit: setName,
});
const { runAfterTasks, isRunning } = useAfterTasks(async context => {
  await save({ name }, context);
}, { onError: error => console.error(error) });

<input value={name} readOnly={isRunning}
  onChange={event => {
    const value = event.currentTarget.value;
    nameField.change(value); // 編集時点で古い結果を無効化
    setName(value);          // 表示用のReact stateを更新
  }}
  onBlur={nameField.commit}
/>
<button type="button" onClick={runAfterTasks} disabled={isRunning}>保存</button>
```

runAfterTasks時にもdirty項目を確定するため、blurが発生しなくても保存前に確定できます。`change`はstateを変更しないのでsetterも呼んでください。`phase`/`error`で項目状態を参照でき、別コンポーネントからは`useAfterTasksFieldState("name")`でも購読できます。

初期valueは確定済みです。編集・外部value変更はdirtyになります。同じ値を再確定する場合は`reset(value)`または`resetKey`の変更を使います。入力を動的に取り外す場合は、Hookを呼ぶ子コンポーネントをunmountします。

## 任意の入力UIを使う

```tsx
import { AfterTasksInput } from "./AfterTasksInput";

<AfterTasksInput
  taskKey="name"
  value={name}
  onChange={(event) => setName(event.currentTarget.value)}
  normalize={(input, { signal }) => normalizeName(input, { signal })}
  onCommit={setName}
/>;
```

文字列のtext/search/email/tel/url/password入力専用です。`normalize`と`onCommit`は必須です。入力UIが不要なら、このファイルはコピーしません。

## API

| API                                                  | import元            | 用途                                                          |
| ---------------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| AfterTasksProvider                                   | AfterTasks          | フォーム単位の管理範囲・初期設定                              |
| useAfterTasks().registerAsyncTask(factory, options?) | AfterTasks          | signalを準備してから処理を開始                                |
| useAfterTasks(action, options)                       | AfterTasks          | runAfterTasks/isRunning/hasPendingTasks/phase/requestIdを取得 |
| useLatestCommitted(value)                            | useLatestCommitted  | 最新commit済み値を返す安定したgetter                          |
| useAfterTasksField(options)                          | useAfterTasksField  | 入力確定・世代管理                                            |
| useAfterTasksFieldState(key)                         | useAfterTasksField  | 入力のclean/dirty/pending/error状態を購読                     |
| AfterTasksInput                                      | AfterTasksInput     | 入力Hookを組み込んだUI                                        |
| useAfterTasksSubmit(runAfterTasks)                   | useAfterTasksSubmit | IME対応のformイベント群                                       |

タスク登録は`registerAsyncTask(factory, options?)`だけを公開します。互換API・別名は提供しません。戻り値の`handle.result`はrejectせず、statusで判別する結果を返します。

```tsx
const tasks = useAfterTasks();
const handle = tasks.registerAsyncTask(
  ({ signal }) => fetch("/api/name", { signal }),
  { timeoutMs: 5000 },
);
const result = await handle.result;
if (result.status === "fulfilled") console.log(result.value);
// handle.cancel()で中断を要求できます。
```

背景処理は`blocking: false`を指定できます。その失敗はProviderのonTaskErrorへ通知しますが、保存を阻止しません。送信データを変える処理はblockingのままにしてください。全タスクの自動検出やglobal Promise/fetchの差し替えは行いません。

`runAfterTasks`は実行予約用のvoid関数です。`await runAfterTasks()`では保存完了を待てません。保存後の遷移等はaction内に書きます。画面のフォームstateをrefへコピーする必要はありません。

## なぜ単純なawaitだけでは足りないか

Reactのイベント関数は、そのレンダー時点のstateを保持します。古いイベント関数の中でPromiseを待っても、その関数のstateが最新に変わるわけではありません。

useAfterTasksはタスク完了後にstateを更新し、対応する新しいレンダーのEffectからactionを呼びます。レンダー番号とタスクのrevisionを確認するため、待機完了とEffectの間にタスクが増えた場合も再確認します。flushSyncや固定時間のsleepで順番を推測しません。

## サンプルと開発用ファイル

| ファイル                   | 役割                                                  |
| -------------------------- | ----------------------------------------------------- |
| src/ExampleForm.tsx        | 通常input + 入力Hook、IME、項目エラー、エラー表示の例 |
| src/PlainBlurExample.tsx   | 中心ファイルだけでblurからタスク登録する例            |
| src/LatestStateExample.tsx | await後に最新commit済み値を読む例                     |
| src/exampleSaveAdapter.ts  | HTTPの契約例とメモリ上のfake                          |
| tests / browser-tests      | 単体・結合・SSR・ブラウザー操作テスト                 |
| scripts/check-copy.mjs     | 中心ファイル単独・任意ファイルの組み合わせを型検証    |
| AGENTS.md                  | コード編集時に守る構成・API・コメント・検証の方針     |

## エラーのタイミング

- `onTaskError`と`useAfterTasksFieldState`は、入力処理の失敗を即時に通知・表示するためのものです。
- `useAfterTasks`の`onError`は、runAfterTasksで要求した処理の失敗（beforeWait、入力待機、保存等）の通知です。
- 入力のエラーは同じ項目の新しい確定が成功するまで保持します。他項目の成功では解除しません。
- normalizeでcatchして成功扱いにすると保存を止められません。エラーはthrow/rejectしてください。
- 動的に入力を削除すると、その所有者のpending/errorも解除します。同じkeyの別入力への遅延完了・cleanupは作用しません。
- taskKeyは同じScopeのmanaged入力間で一意にします。重複はエラーです。
- `clearErrors()`は全体エラーを解除し、失敗したmanaged入力を再確定します。保存ごとに呼ばないでください。

## タイムアウトとAPIエラー

入力タスク・総待機・保存の期限はすべて省略時null（無期限）です。Providerで設定し、registerAsyncTask/useAfterTasksFieldのtimeoutMs、useAfterTasksのwaitTimeoutMs/actionTimeoutMsで上書きできます。0・負数・NaN・Infinityは設定エラーです。

入力タスクや総待機が期限切れになった場合、onErrorへ通知して保存を開始しません。保存actionの期限切れではsignalで中断を要求してonErrorへtimeoutを通知し、元のactionが実際に終了するまでisRunningを維持します。中断要求は通信先の対応が必要です。

APIがthrow/rejectした場合、共通側はonErrorへ通知し、処理終了後にisRunningを解除します。API側で処理済みのエラーはaction内でcatchして終了すれば、共通側からの通知は行いません。結果照会や再送判断はAPI呼び出し側へ任せます。共通側の自動再送はありません。

```tsx
const { registerAsyncTask, runAfterTasks, isRunning, hasPendingTasks } =
  useAfterTasks((context) => saveApi(values, context), {
    onError: (error) => setError(String(error)),
  });
```

requestIdは保存要求ごとのIDとして通信層へ渡せます。ログ記録や必要に応じたAPI側の重複排除に利用してください。

## 最新stateを読む2つの方法

通常の保存はaction開始時のsnapshotを使います。action内でawaitしている間に変わったstateまで自動的に読み直すものではありません。

```tsx
import { useLatestCommitted } from "./useLatestCommitted";

const getValues = useLatestCommitted(values);
const { runAfterTasks } = useAfterTasks(
  async () => {
    await checkPermission();
    await save(getValues()); // この時点の最新commit済み値が必要な場合だけ
  },
  { onError: showError },
);
```

getterはcommitを待ちません。`setValues(next); getValues()`でnextを保証しません。render中にはrefを書き換えず、破棄されたレンダーの値も公開しません。

## IME・フォーカス・イベント

```tsx
import { useAfterTasksSubmit } from "./useAfterTasksSubmit";

const submitEvents = useAfterTasksSubmit(runAfterTasks);
return (
  <form {...submitEvents}>
    <AfterTasksInput {...inputProps} />
    <button type="submit">保存</button>
  </form>
);
```

compositionイベント、isComposing、互換の229、Enterの押下/解放を追跡します。変換確定のEnterを抑止し、別のEnterや明示クリックは許可します。OSのIMEによって順序差があるため、後述の手動確認も必要です。

useAfterTasksFieldの入力はrunAfterTasks時にもdirtyを確定するため、blurが発生しなくても動作します。通常のonBlurからタスクを登録する場合も、既定の自動blurで登録が始まります。onBlur内では最初のawaitより前にregisterAsyncTaskを呼んでください。

preventDefaultは元のイベント中に行います。SyntheticEventをactionへ渡しません。blur開始時に保存ボタンを消したりdisabled化するとclick自体が届かないことがあるため、runAfterTasks受付後にisRunningで制御します。

window.open/clipboard/file pickerなどユーザー操作が必要なAPIは遅延actionで保証できません。たとえば新しいウィンドウが必要なら、元のクリック内で`const popup = window.open('about:blank')`を実行し、戻り値nullも処理したうえで、その後の通信をrunAfterTasksへ渡します。ブラウザーの権限要件を回避する仕組みではありません。

## 対応範囲と制約

- React 18.3/19、TypeScript、ES2022以上とDOMを想定します。SSRでは処理を開始しません。Next.jsでは利用先のクライアント境界を設定してください。
- 必要なstate更新は通常優先度の確定処理で行います。startTransition/Suspense/Effectによる任意の将来の更新をすべて待つ保証はありません。
- normalize/onCommit、beforeWait、エラーコールバックの契約を守ってください。onCommit/beforeWaitにasync関数を渡す誤用は検出しますが、既にその関数内で発生した副作用は取り消せません。
- 任意のaction内部の直接的なUI更新・サーバー副作用も撤回できません。通信の中断・エラー表示・再送判断はAPI呼び出し側で扱ってください。
- Provider破棄は購読・タイマー・予約・managed入力を掃除します。StrictModeの再接続にも対応します。保存開始後の画面離脱では中断を要求し、同じScopeが残る場合は元action終了までisRunningを維持します。
- Portal/Shadow DOMをまたぐcompositionやフォーカスの自動収集は保証しません。formイベントが届く範囲で利用してください。
- サンプルはisRunning中の編集をreadOnlyで抑止します。共通入力の世代管理は再編集されても古い結果を反映しません。

## 開発と検証

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run check:copy
npm run build
npm run dev
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
```

CIはReact 18/19の単体・型・コピー検証と、3種類のブラウザーを対象にします。実行済みの結果と環境の制約はVERIFICATION.mdを参照してください。

### 実OSのIME手動確認

Windows日本語IME + Chrome/Edge、macOS日本語入力 + Safariで、入力→変換→Enter確定→別Enter保存、変換候補表示中の保存クリック、Space変換、Tab移動を確認します。変換確定だけで保存されず、明示した保存が1回だけ実行されること、保存値が正規化後の値であることを確認してください。合成compositionイベントの成功を実OSの検証済みとは扱いません。

## 同期blurはタスク登録が必要か

**同期的な整形と通常のsetStateだけなら、registerAsyncTaskへの登録は不要です。** onBlurへ直接書けます。同期関数も登録できますが、同期blurのためだけに登録する必要はありません。

通常のフォーカス移動で「blur → click」と別々のユーザーイベントが発生する場合は、blurの同期処理が終了し、通常のReactのstate更新が反映されてからclick側のハンドラーが動きます。これはstartTransitionによる更新や、依存配列の不足などで古い値を閉じ込めたハンドラーには当てはまりません。

一方、**同じclickハンドラーの中でblur()を呼んでも、そのハンドラーが参照するstate変数は更新されません。**

```tsx
// 注意: onBlurでsetValueしても、このvalueはclick開始時のレンダーの値です。
const handleClick = () => {
  inputRef.current?.blur();
  save(value);
};
```

保存をrunAfterTasksへ渡せば、登録タスクがない場合でも、既定の自動blurと再レンダーを経て、更新後のstateを参照するactionで保存できます。

```tsx
import { useAfterTasks } from "./AfterTasks";

// AfterTasksProviderの配下で使います。
const { runAfterTasks, isRunning } = useAfterTasks(() => save(value), {
  onError: showError,
});

// 同期blurは直接setStateして構いません。
// <input value={value} onChange={e => setValue(e.currentTarget.value)}
//   onBlur={e => setValue(e.currentTarget.value.trim())} />
// <button onClick={runAfterTasks} disabled={isRunning}>保存</button>
```

非同期blurは、最初のawaitより前にregisterAsyncTaskを呼び、完了まで待つ処理を登録してください。未登録の非同期処理は自動検出しません。Enter送信などでは自然なblurが発生しない場合があるため、保存経路をrunAfterTasksに揃えると自動blurも利用できます。blurActiveElement:falseを指定した場合は、自動blurは行いません。

## 自動フォーカス解除のオプション

`blurActiveElement`は省略時trueです。実行順序は、重複要求の排除 → フォーカス中のHTML要素のblur → beforeWait → 入力確定・タスク待機 → 再レンダー → actionです。

対象は`document.activeElement`で、Provider内のフォームに限定されません。別フォームやダイアログの入力・保存ボタンからもフォーカスが外れる場合があります。iframeやShadow DOM内部を再帰的に探索しません。

```tsx
const { runAfterTasks } = useAfterTasks((context) => save(values, context), {
  onError: showError,
  blurActiveElement: false, // フォーカスを維持する場合
  beforeWait: () => setError(null), // 同期の準備処理。asyncにはしない
  waitTimeoutMs: null, // 入力タスクは無期限で待つ
  actionTimeoutMs: 30000, // 保存開始から30秒。期限超過時は中断要求し、元処理終了までisRunningを維持
});
```

対象を限定する場合は自動blurをfalseにし、beforeWaitで対象inputだけをblurできます。useAfterTasksFieldはfalseでもdirty入力を確定します。blur()が非同期ハンドラー自体をawaitするわけではなく、Contextへ登録されたタスクの完了を待ちます。

## Lintと整形

```sh
npm run lint          # TypeScript・React Hooks・JavaScriptの検査（警告も失敗扱い）
npm run lint:fix      # ESLintで自動修正できる指摘を修正
npm run format       # ソース・設定・MarkdownをPrettierで整形
npm run format:check # 整形済みかを確認（ファイルは変更しない）
```

ESLintはflat configの`eslint.config.js`、Prettierは`.prettierrc.json`で設定します。整形ルールはPrettierへ集約し、ESLintとの競合を避けます。生成物や一時コピーは対象から除外します。CIではReact 18/19の両ジョブでlintと整形チェックも実行します。

## テストの配置

単体テストはsrcの相対パスとファイル名に対応させます。例えばsrc/AfterTasks.tsxのテストはtests/AfterTasks.test.tsxです。srcにサブディレクトリを追加した場合も同じ階層を使います。

| 実装                       | 単体テスト                         |
| -------------------------- | ---------------------------------- |
| src/AfterTasks.tsx         | tests/AfterTasks.test.tsx          |
| src/useAfterTasksField.ts  | tests/useAfterTasksField.test.tsx  |
| src/AfterTasksInput.tsx    | tests/AfterTasksInput.test.tsx     |
| src/useAfterTasksSubmit.ts | tests/useAfterTasksSubmit.test.tsx |
| src/useLatestCommitted.ts  | tests/useLatestCommitted.test.tsx  |
| src/exampleSaveAdapter.ts  | tests/exampleSaveAdapter.test.ts   |

フォームや複数部品の連携、SSRなどの結合テストはtests/integration/に配置します。例示コンポーネントは結合テストから検証します。tests/helpers.tsはPromiseの完了タイミングなどを制御するテスト用ヘルパーです。browser-tests/は実ブラウザーでの結合テストとして別配置を維持します。npm testで単体・結合の両方を実行します。

## keyを省略した登録と全件待機

```tsx
registerAsyncTask(({ signal }) => normalize(input, { signal }), {
  onCommit: setValue,
});
```

keyは不要です。登録ごとにUUIDを自動生成し、同じProviderで登録された対象タスクをすべて待ちます。待機中に追加されたタスクも確認し、全件完了・state反映後のレンダーからclickに指定したactionを実行します。onCommitも不要なら第2引数自体を省略できます。

```tsx
registerAsyncTask(({ signal }) => validate(input, { signal }));
```

同じ処理の再登録で前の結果を無効化したい場合だけ、`{ key: "name" }`を指定します。自動UUIDでは各登録が独立しているため、前の登録を自動で無効化しません。UUID APIのない環境では時刻と連番による一意なIDを使います。background用のblocking:false、失敗・取消などの既存ルールは同じです。

## hasPendingTasksとisRunning

`hasPendingTasks`は、未完了の登録タスクが1件でもある間trueです。keyなしで登録したタスクやblocking:falseの背景処理も含み、同じProviderの全子孫で共有します。引数なしのuseAfterTasksからも購読できます。

```tsx
const { registerAsyncTask, runAfterTasks, isRunning, hasPendingTasks } =
  useAfterTasks((context) => save(values, context), { onError: showError });
// hasPendingTasksは入力の処理中表示に使い、保存ボタンの無効化にはisRunningを使います。
```

| 状態                                     | hasPendingTasks | isRunning |
| ---------------------------------------- | --------------- | --------- |
| 入力タスクだけが実行中                   | true            | false     |
| 保存要求後、入力タスクを待っている       | true            | true      |
| 入力タスク完了後、保存actionだけが実行中 | false           | true      |
| すべて完了                               | false           | false     |

未確定入力(dirty)だけの状態はhasPendingTasksに含みません。タスクの取消・期限切れでは管理対象から外れるため、元のPromiseが残っていてもhasPendingTasksを解除します。blur直後に保存ボタンを無効化するとclickが届かなくなる場合があるので、ボタンのdisabledはisRunningを使います。

## useAfterTasksの戻り値

戻り値の型はAfterTasksExecutionとAfterTasksSnapshotで公開し、各プロパティにも説明コメントを付けています。

| 項目            | 意味と利用場面                                                            |
| --------------- | ------------------------------------------------------------------------- |
| runAfterTasks   | イベントから実行を予約するvoid関数。タスクとstate反映を待ってactionを呼ぶ |
| isRunning       | 保存要求の入力待機・保存実行中。ボタンの無効化に使う                      |
| hasPendingTasks | 未完了の登録タスクあり。入力処理中の表示に使う                            |
| phase           | idle/preparing/waiting/ready/executingの現在段階                          |
| requestId       | 保存要求の識別子。要求がない場合はnull。入力タスクのUUIDとは別            |

中心ファイルのuseAfterTasksExecutionのreturnではspreadを使わず、全5項目を説明付きで列挙しています。

### キー省略時の失敗を解除して再試行する

キー省略時は登録ごとにUUIDが異なるため、別の登録が成功しても以前の失敗は残ります。
再試行を受け付ける際は、失敗した登録のハンドルから`clearError()`を呼びます。
他の入力の失敗まで解除せず、その登録だけを解除できます。

```tsx
const handle = registerAsyncTask(({ signal }) => normalize(input, { signal }), {
  onCommit: setValue,
});
const result = await handle.result;
if (result.status === "rejected" || result.status === "timedOut") {
  // 再試行ボタンなどで、この解除と新しい登録を行います。
  // handle.clearError();
  // registerAsyncTask(...);
}
```

`clearError()`は取消や再実行を行いません。同じ固定keyの別登録が後から失敗した場合、
古いハンドルでは新しい失敗を解除できません。画面全体を明示的に回復させる場合は
`clearErrors()`を使用します。同じkeyでの再登録は、従来どおり先行処理を置き換えます。

## 大量入力フォームの性能検証

10・100・500項目の登録・blur・保存待機・state更新を計測できます。実行方法と測定の限界は[benchmarks/README.md](./benchmarks/README.md)、改善前との実測比較は[benchmarks/RESULTS.md](./benchmarks/RESULTS.md)を参照してください。
