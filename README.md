# React AsyncTasks

非同期blurで入力を確定してから、最新のレンダーのstateで保存するための共通処理です。
**`src/AsyncTasks.tsx`の1ファイルだけコピー**して利用できます。React以外の実行時依存はありません。

## 無期限で待つ設定

`null`を指定するとタイムアウトしません。**入力タスク・総待機・保存の3種類**を無期限にする場合は、Providerに次を指定します。

```tsx
<AsyncTasksProvider
  taskTimeoutMs={null}
  waitTimeoutMs={null}
  actionTimeoutMs={null}
>
  <EditForm />
</AsyncTasksProvider>
```

省略時は従来どおり15秒・30秒・30秒です。`null`と省略（undefined）は異なります。`Infinity`や0は使いません。Hookの`waitTimeoutMs: null`・`actionTimeoutMs: null`、track/useAsyncFieldの`timeoutMs: null`で個別上書きもできます。外部APIやfetch、サーバー自体の期限が延びるわけではありません。

無期限の処理がresolve/rejectしない間はbusyが継続します。`null`は期限だけを無効化し、明示的なcancelやunmount時の後始末は無効化しません。

## TrackedInputなし: 既存のblur処理を登録する

通常のinputとContextだけで使えます。`src/PlainBlurExample.tsx`に、Providerとエラー表示を含めた例があります。

```tsx
const { register } = useAsyncTasks();
const { run, busy, blocked } = useAfterTasks(async () => {
  await save(values);
}, {
  beforeWait: () => inputRef.current?.blur(),
  onError: error => setError(String(error)),
});

<input ref={inputRef} onBlur={event => {
  register(handleBlur(event.currentTarget.value), "name");
}} />
<button type="button" onClick={run} disabled={busy || blocked}>保存</button>
```

既存のhandleBlurはasync関数でよく、更新後のレンダーで保存処理を呼びます。ただし、古いhandleBlur内部の直接的なsetStateは取消できません。再編集との競合も防ぐ場合は次のHookを使います。

## TrackedInputなし: 再編集時の古い結果も破棄する

`useAsyncField`を使えば、入力DOMは通常のinputや既存のUIライブラリーの部品のままで利用できます。

```tsx
const [name, setName] = useState("");
const nameField = useAsyncField({
  taskKey: "name",
  value: name,
  normalize: (input, { signal }) => normalizeName(input, { signal }),
  onCommit: setName,
});
const { run, busy, blocked } = useAfterTasks(async context => {
  await save({ name }, context);
}, { onError: error => console.error(error) });

<input value={name} readOnly={busy || blocked}
  onChange={event => {
    const value = event.currentTarget.value;
    nameField.change(value); // 編集時点で古い非同期結果を無効化
    setName(value);          // 表示用のReact stateを更新
  }}
  onBlur={nameField.commit}
/>
<button type="button" onClick={run} disabled={busy || blocked}>保存</button>
```

上記HookはProviderの子コンポーネントで使用します。`run`時にもdirty項目を確定するので、blurが発生しなくても保存前に確定できます。`change`は画面のstateを変更しないため、setterも呼んでください。Hookの`phase`/`error`で項目状態を参照でき、`reset(value)`で明示的な再確定を要求できます。

**標準のExampleFormも通常のinput + useAsyncFieldへ変更しました。TrackedInputは必須ではなく、互換性のため任意の補助部品として残しています。**

`run`は実行予約用のvoid関数です。`await run()`では保存完了を待てません。保存後の遷移等はaction内に書きます。画面のフォームstateをrefへコピーする必要はありません。

## 内容

| ファイル                   | 役割                                                     |
| -------------------------- | -------------------------------------------------------- |
| src/AsyncTasks.tsx         | Context、タスク管理、Hook、入力、submit補助（配布用）    |
| src/ExampleForm.tsx        | 複数入力、IME、即時エラー表示、保存結果照会の例          |
| src/PlainBlurExample.tsx   | 既存のasync blurをContextへ登録する最小例                |
| src/LatestStateExample.tsx | await後に最新committed値を読む例                         |
| src/exampleSaveAdapter.ts  | HTTPの契約例とメモリ上のfake。共通ファイルの依存ではない |
| tests                      | 単体・結合・SSRテスト                                    |
| browser-tests              | ブラウザーの操作テストと最小デモ                         |

## なぜ単純なawaitだけでは足りないか

Reactのイベント関数は、そのレンダー時点のstateを保持します。古いイベント関数の中でPromiseを待っても、その関数のstateが最新に変わるわけではありません。

このHookはタスクを待った後にHookのstateを更新し、対応する新しいレンダーのEffectからactionを呼びます。レンダー番号とタスクのrevisionを両方確認するため、待機完了とEffectの間にタスクが増えた場合も再確認します。flushSyncや固定時間のsleepで順番を推測しません。

## 旧onBlur形式からの移行

旧形式は互換性を維持しています。

```tsx
<TrackedInput
  taskKey="name"
  onBlur={async (event) => {
    const input = event.currentTarget.value; // awaitより前に取得
    await legacyBlur(input);
  }}
/>
```

ただし、legacyBlurが直接行うsetStateやその他の副作用を共通処理から取り消すことはできません。**古い結果の上書きを防ぐにはuseAsyncField等のnormalize/onCommit方式へ移行**してください。両方式は同時指定できません。

managed形式は文字列のtext/search/email/tel/url/password入力専用です。初期valueは確定済みとして扱います。編集・外部value変更はdirtyとなり、blurまたはrunで確定されます。同じ値を明示的に再確定したい場合はresetKeyを変更するか、`tasks.resetField(key, value)`を使います。

## API

| API                                           | 用途                                             |
| --------------------------------------------- | ------------------------------------------------ |
| AsyncTasksProvider                            | フォーム単位の管理範囲・初期設定                 |
| useAfterTasks(action, options)                | run/busy/blocked/phase/requestId/reconcileを取得 |
| useAsyncTasks().register(promise, key?)       | 開始済みPromiseの登録（互換形式）                |
| useAsyncTasks().track(key, factory, options?) | signalを準備してから処理を開始                   |
| useAsyncField(options)                        | 通常のinputから使える入力確定・世代管理Hook      |
| useTaskField(key)                             | managed入力のclean/dirty/pending/error状態を購読 |
| useLatestCommitted(value)                     | 最新committed値を返す安定したgetter              |
| useAsyncSubmit(run)                           | IME対応のformイベント群                          |

`track`のhandle.resultはrejectせず、statusで判別する結果を返します。

```tsx
const tasks = useAsyncTasks();
const handle = tasks.track(
  "name",
  ({ signal }) => fetch("/api/name", { signal }),
  {
    timeoutMs: 5000,
  },
);
const result = await handle.result;
if (result.status === "fulfilled") console.log(result.value);
// handle.cancel()で中断を要求できます。
```

背景処理は`blocking: false`を指定できます。その失敗はProviderのonTaskErrorへ通知しますが、保存を阻止しません。送信データを変える処理はblockingのままにしてください。全タスクの自動検出やglobal Promise/fetchの差し替えは行いません。

## エラーのタイミング

- `onTaskError`と`useTaskField`は、入力処理の失敗を即時に通知・表示するためのものです。
- `useAfterTasks`の`onError`は、runで要求した処理の失敗（beforeWait、入力待機、保存等）の通知です。
- 入力のエラーは同じ項目の新しい確定が成功するまで保持します。他項目の成功では解除しません。
- normalizeでcatchして成功扱いにすると保存を止められません。エラーはthrow/rejectしてください。
- 動的に入力を削除すると、その所有者のpending/errorも解除します。同じkeyの別入力への遅延完了・cleanupは作用しません。
- taskKeyは同じScopeのmanaged入力間で一意にします。重複はエラーです。
- `clearErrors()`は全体エラーを解除し、失敗したmanaged入力を再確定します。保存ごとに呼ばないでください。

## タイムアウトと結果不明

既定値は入力タスク15秒、総待機30秒、action30秒。Providerで設定し、track/TrackedInputのtimeoutMsやuseAfterTasksのwaitTimeoutMs/actionTimeoutMsで上書きできます。`null`は期限なし、0/負数/NaN/Infinityは設定エラーです。Providerの設定は初期化時に固定です。

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
const submitEvents = useAsyncSubmit(run);
return (
  <form {...submitEvents}>
    <TrackedInput {...inputProps} />
    <button type="submit">保存</button>
  </form>
);
```

compositionイベント、isComposing、互換の229、Enterの押下/解放を追跡します。変換確定のEnterを抑止し、別のEnterや明示クリックは許可します。OSのIMEによって順序差があるため、後述の手動確認も必要です。

managed入力はrun時にもdirtyを確定するため、blurが発生しなくても動作します。旧onBlur方式ではbeforeWaitから対象フォーム内のactiveElement.blur()を同期的に呼ぶ必要がある場合があります。ExampleFormに例を示しています。

preventDefaultは元のイベント中に行います。SyntheticEventをactionへ渡しません。blur開始時に保存ボタンを消したりdisabled化するとclick自体が届かないことがあるため、run受付後にbusy/blockedで制御します。

window.open/clipboard/file pickerなどユーザー操作が必要なAPIは遅延actionで保証できません。たとえば新しいウィンドウが必要なら、元のクリック内で`const popup = window.open('about:blank')`を実行し、戻り値nullも処理したうえで、その後の通信をrunへ渡します。ブラウザーの権限要件を回避する仕組みではありません。

## 対応範囲と制約

- React 18.3/19、TypeScript、ES2021以上とDOMを想定します。SSRでは処理を開始しません。Next.jsでは利用先のクライアント境界を設定してください。
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
npm run dev
npx playwright install --with-deps chromium firefox webkit
npm run test:browser
```

CIはReact 18/19の単体・型・コピー検証と、3種類のブラウザーを対象にします。実行済みの結果と環境の制約はVERIFICATION.mdを参照してください。

### 実OSのIME手動確認

Windows日本語IME + Chrome/Edge、macOS日本語入力 + Safariで、入力→変換→Enter確定→別Enter保存、変換候補表示中の保存クリック、Space変換、Tab移動を確認します。変換確定だけで保存されず、明示した保存が1回だけ実行されること、保存値が正規化後の値であることを確認してください。合成compositionイベントの成功を実OSの検証済みとは扱いません。
