# React AsyncTasks

非同期blurで入力を確定してから、最新のレンダーのstateで保存するための共通処理です。
**中心の`src/AsyncTasks.tsx`だけで、Context・タスク登録・完了待機・保存を利用できます。** 入力HookやUI、form送信の補助は任意ファイルです。React以外の実行時依存はありません。

## 必要なファイルだけコピーする

| 利用する機能                                           | コピーするファイル                    |
| ------------------------------------------------------ | ------------------------------------- |
| タスク登録・待機後のイベント実行                       | `AsyncTasks.tsx`だけ                  |
| 入力の自動確定・再編集時の古い結果の破棄・項目状態表示 | 上記 + `useAsyncField.ts`             |
| 入力UIも共通化する                                     | 上記2ファイル + `TrackedInput.tsx`    |
| formのIME・Enter送信を補助する                         | 必要に応じて`useAsyncSubmit.ts`を追加 |

```tsx
// 必須の中心ファイル
import { AsyncTasksProvider, useAsyncTasks, useAfterTasks } from "./AsyncTasks";
// 以下は利用するものだけimportします。
import { useAsyncField, useTaskField } from "./useAsyncField";
import { TrackedInput } from "./TrackedInput";
import { useAsyncSubmit } from "./useAsyncSubmit";
```

中心ファイルから任意ファイルをimport・再exportしません。中心側には、任意の入力が登録された場合にdirty（未確定）入力を保存前に確定するための共通管理を持たせています。任意HookのコードやUIファイルを配布先へ持ち込む必要はありません。

## 無期限で待つ設定

`null`を指定するとタイムアウトしません。入力タスク・総待機・保存の3種類を無期限にする場合は、Providerに次を指定します。

```tsx
<AsyncTasksProvider
  taskTimeoutMs={null}
  waitTimeoutMs={null}
  actionTimeoutMs={null}
>
  <EditForm />
</AsyncTasksProvider>
```

省略時は15秒・30秒・30秒です。`null`と省略（undefined）は異なります。`Infinity`や0は使いません。`useAfterTasks`の`waitTimeoutMs`/`actionTimeoutMs`、`registerAsyncTask`/`useAsyncField`の`timeoutMs`で個別上書きできます。外部APIやサーバー自体の期限が延びるわけではありません。

未完了の処理がある間はbusyが継続します。`null`は期限だけを無効化し、cancelやunmount時の後始末は無効化しません。

## 中心ファイルだけで使う

通常のinputのblurからタスクを登録できます。`src/PlainBlurExample.tsx`に、Providerとエラー表示を含めた例があります。HookはProviderの子コンポーネントで使います。

```tsx
const { registerAsyncTask } = useAsyncTasks();
const { run, busy, blocked } = useAfterTasks(async context => {
  await save({ name }, context);
}, {
  beforeWait: () => inputRef.current?.blur(),
  onError: error => setError(String(error)),
});

<input ref={inputRef} value={name} readOnly={busy || blocked}
  onChange={event => setName(event.currentTarget.value)}
  onBlur={event => {
    const input = event.currentTarget.value; // イベントの値は同期的に取得
    registerAsyncTask("name", ({ signal }) => normalizeName(input, { signal }), {
      onCommit: setName, // 有効な最新の結果だけをstateへ反映
    });
  }}
/>
<button type="button" onClick={run} disabled={busy || blocked}>保存</button>
```

非同期関数は結果を返し、state更新は`onCommit`へ分けます。同じkeyで再登録すると古い結果を破棄します。次のblurより前の再編集でも古い結果を破棄したい場合は、次の入力Hookを追加します。

## 任意の入力Hookを使う

`useAsyncField`を使えば、DOMは通常のinputや既存UIライブラリーの部品を使えます。`useTaskField`は同じファイルにある状態表示用Hookです。

```tsx
import { useAsyncField, useTaskField } from "./useAsyncField";

const [name, setName] = useState("");
const nameField = useAsyncField({
  taskKey: "name", value: name,
  normalize: (input, { signal }) => normalizeName(input, { signal }),
  onCommit: setName,
});
const { run, busy, blocked } = useAfterTasks(async context => {
  await save({ name }, context);
}, { onError: error => console.error(error) });

<input value={name} readOnly={busy || blocked}
  onChange={event => {
    const value = event.currentTarget.value;
    nameField.change(value); // 編集時点で古い結果を無効化
    setName(value);          // 表示用のReact stateを更新
  }}
  onBlur={nameField.commit}
/>
<button type="button" onClick={run} disabled={busy || blocked}>保存</button>
```

run時にもdirty項目を確定するため、blurが発生しなくても保存前に確定できます。`change`はstateを変更しないのでsetterも呼んでください。`phase`/`error`で項目状態を参照でき、別コンポーネントからは`useTaskField("name")`でも購読できます。

初期valueは確定済みです。編集・外部value変更はdirtyになります。同じ値を再確定する場合は`reset(value)`または`resetKey`の変更を使います。入力を動的に取り外す場合は、Hookを呼ぶ子コンポーネントをunmountします。

## 任意の入力UIを使う

```tsx
import { TrackedInput } from "./TrackedInput";

<TrackedInput
  taskKey="name"
  value={name}
  onChange={(event) => setName(event.currentTarget.value)}
  normalize={(input, { signal }) => normalizeName(input, { signal })}
  onCommit={setName}
/>;
```

文字列のtext/search/email/tel/url/password入力専用です。`normalize`と`onCommit`は必須です。入力UIが不要なら、このファイルはコピーしません。

## API

| API                                                       | import元       | 用途                                             |
| --------------------------------------------------------- | -------------- | ------------------------------------------------ |
| AsyncTasksProvider                                        | AsyncTasks     | フォーム単位の管理範囲・初期設定                 |
| useAsyncTasks().registerAsyncTask(key, factory, options?) | AsyncTasks     | signalを準備してから処理を開始                   |
| useAfterTasks(action, options)                            | AsyncTasks     | run/busy/blocked/phase/requestId/reconcileを取得 |
| useLatestCommitted(value)                                 | AsyncTasks     | 最新commit済み値を返す安定したgetter             |
| useAsyncField(options)                                    | useAsyncField  | 入力確定・世代管理                               |
| useTaskField(key)                                         | useAsyncField  | 入力のclean/dirty/pending/error状態を購読        |
| TrackedInput                                              | TrackedInput   | 入力Hookを組み込んだUI                           |
| useAsyncSubmit(run)                                       | useAsyncSubmit | IME対応のformイベント群                          |

タスク登録は`registerAsyncTask(key, factory, options?)`だけを公開します。互換API・別名は提供しません。戻り値の`handle.result`はrejectせず、statusで判別する結果を返します。

```tsx
const tasks = useAsyncTasks();
const handle = tasks.registerAsyncTask(
  "name",
  ({ signal }) => fetch("/api/name", { signal }),
  { timeoutMs: 5000 },
);
const result = await handle.result;
if (result.status === "fulfilled") console.log(result.value);
// handle.cancel()で中断を要求できます。
```

背景処理は`blocking: false`を指定できます。その失敗はProviderのonTaskErrorへ通知しますが、保存を阻止しません。送信データを変える処理はblockingのままにしてください。全タスクの自動検出やglobal Promise/fetchの差し替えは行いません。

`run`は実行予約用のvoid関数です。`await run()`では保存完了を待てません。保存後の遷移等はaction内に書きます。画面のフォームstateをrefへコピーする必要はありません。

## なぜ単純なawaitだけでは足りないか

Reactのイベント関数は、そのレンダー時点のstateを保持します。古いイベント関数の中でPromiseを待っても、その関数のstateが最新に変わるわけではありません。

useAfterTasksはタスク完了後にstateを更新し、対応する新しいレンダーのEffectからactionを呼びます。レンダー番号とタスクのrevisionを確認するため、待機完了とEffectの間にタスクが増えた場合も再確認します。flushSyncや固定時間のsleepで順番を推測しません。

## サンプルと開発用ファイル

| ファイル                   | 役割                                                    |
| -------------------------- | ------------------------------------------------------- |
| src/ExampleForm.tsx        | 通常input + 入力Hook、IME、項目エラー、保存結果照会の例 |
| src/PlainBlurExample.tsx   | 中心ファイルだけでblurからタスク登録する例              |
| src/LatestStateExample.tsx | await後に最新commit済み値を読む例                       |
| src/exampleSaveAdapter.ts  | HTTPの契約例とメモリ上のfake                            |
| tests / browser-tests      | 単体・結合・SSR・ブラウザー操作テスト                   |
| scripts/check-copy.mjs     | 中心ファイル単独・任意ファイルの組み合わせを型検証      |
| AGENTS.md                  | コード編集時に守る構成・API・コメント・検証の方針       |

## エラーのタイミング

- `onTaskError`と`useTaskField`は、入力処理の失敗を即時に通知・表示するためのものです。
- `useAfterTasks`の`onError`は、runで要求した処理の失敗（beforeWait、入力待機、保存等）の通知です。
- 入力のエラーは同じ項目の新しい確定が成功するまで保持します。他項目の成功では解除しません。
- normalizeでcatchして成功扱いにすると保存を止められません。エラーはthrow/rejectしてください。
- 動的に入力を削除すると、その所有者のpending/errorも解除します。同じkeyの別入力への遅延完了・cleanupは作用しません。
- taskKeyは同じScopeのmanaged入力間で一意にします。重複はエラーです。
- `clearErrors()`は全体エラーを解除し、失敗したmanaged入力を再確定します。保存ごとに呼ばないでください。

## タイムアウトと結果不明

既定値は入力タスク15秒、総待機30秒、action30秒。Providerで設定し、registerAsyncTask/useAsyncField/TrackedInputのtimeoutMsやuseAfterTasksのwaitTimeoutMs/actionTimeoutMsで上書きできます。`null`は期限なし、0/負数/NaN/Infinityは設定エラーです。Providerの設定は初期化時に固定です。

入力timeoutや待機timeoutは保存を開始しません。managed処理はAbortSignalと世代の両方で無効化されます。signalを無視する通信そのものをJavaScriptから強制停止できるわけではありません。

保存のtimeoutは「サーバーで保存されなかった」とは限りません。busy=false/blocked=true/phase=uncertainにして再送を止めます。通信adapterが結果不明を検出したときも`UncertainActionError`をthrowしてください。通常のErrorは未保存が確定した失敗として扱うため、通信エラーを無条件で通常のErrorへ変換しないでください。

```tsx
const { run, busy, blocked, requestId, reconcile } = useAfterTasks(
  (context) => adapter.save(values, context),
  { onError: showError },
);
// サーバーを実際に照会する関数を渡す。固定値を返して解除しない。
const recovered = await reconcile(requestId, (id) => adapter.lookup(id));
```

reconcileは、元actionが実際にsettleし、同じrequestIdの保存結果がsaved/not-savedと確認できた場合だけtrueを返します。元Promiseが永久にpendingの場合や結果unknownの場合はblockedを維持します。ブラウザーの再読込をまたぐ結果不明状態の永続化はアプリ側で行ってください。

requestIdは同じ保存要求内で変わりません。サーバーがIdempotency-Keyを保存・重複排除し、同じキーを異なるpayloadへ流用しない契約が必要です。複数タブの競合はサーバー側の楽観ロック等で扱います。HTTP adapterは契約例であり、実バックエンドを実装してはいません。自動再送は行いません。

## 最新stateを読む2つの方法

通常の保存はaction開始時のsnapshotを使います。action内でawaitしている間に変わったstateまで自動的に読み直すものではありません。

```tsx
const getValues = useLatestCommitted(values);
const { run } = useAfterTasks(
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
import { useAsyncSubmit } from "./useAsyncSubmit";

const submitEvents = useAsyncSubmit(run);
return (
  <form {...submitEvents}>
    <TrackedInput {...inputProps} />
    <button type="submit">保存</button>
  </form>
);
```

compositionイベント、isComposing、互換の229、Enterの押下/解放を追跡します。変換確定のEnterを抑止し、別のEnterや明示クリックは許可します。OSのIMEによって順序差があるため、後述の手動確認も必要です。

useAsyncFieldの入力はrun時にもdirtyを確定するため、blurが発生しなくても動作します。通常のonBlurからタスクを登録する場合は、beforeWaitから対象inputのblur()を同期的に呼びます。PlainBlurExampleに例を示しています。

preventDefaultは元のイベント中に行います。SyntheticEventをactionへ渡しません。blur開始時に保存ボタンを消したりdisabled化するとclick自体が届かないことがあるため、run受付後にbusy/blockedで制御します。

window.open/clipboard/file pickerなどユーザー操作が必要なAPIは遅延actionで保証できません。たとえば新しいウィンドウが必要なら、元のクリック内で`const popup = window.open('about:blank')`を実行し、戻り値nullも処理したうえで、その後の通信をrunへ渡します。ブラウザーの権限要件を回避する仕組みではありません。

## 対応範囲と制約

- React 18.3/19、TypeScript、ES2022以上とDOMを想定します。SSRでは処理を開始しません。Next.jsでは利用先のクライアント境界を設定してください。
- 必要なstate更新は通常優先度の確定処理で行います。startTransition/Suspense/Effectによる任意の将来の更新をすべて待つ保証はありません。
- normalize/onCommit、beforeWait、エラーコールバックの契約を守ってください。onCommit/beforeWaitにasync関数を渡す誤用は検出しますが、既にその関数内で発生した副作用は取り消せません。
- 任意のaction内部の直接的なUI更新・サーバー副作用も撤回できません。signalと結果照会に対応したadapterを利用してください。
- Provider破棄は購読・タイマー・予約・managed入力を掃除します。StrictModeの再接続にも対応します。保存開始後の画面離脱は、同じScopeが残る場合には結果不明として保護します。
- Portal/Shadow DOMをまたぐcompositionやフォーカスの自動収集は保証しません。formイベントが届く範囲で利用してください。
- サンプルはbusy/blocked中の編集をreadOnlyで抑止します。共通入力の世代管理は再編集されても古い結果を反映しません。

## 開発と検証

```sh
npm ci
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
