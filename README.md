# React: Contextのタスクを待って最新stateでイベント処理を実行する

`useAfterTasks` は `{ run, busy }` を返します。`run` を通常のbuttonの `onClick` やフォームの `onSubmit` から呼べます。共通Buttonは不要です。React 18.3/19を想定し、フォームstateをrefへ複製しません。

## ファイル

| ファイル | 役割 |
|---|---|
| src/AsyncTasks.tsx | 配布用1ファイル。Context・タスク管理・useAfterTasks・TrackedInputを含む |
| src/ExampleForm.tsx | 複数入力、非同期blur、保存、エラー表示の使用例 |
| tests/afterTasks.test.tsx | タスク待機・最新state・失敗・連打・アンマウントのテスト |

## 導入

**既存アプリへ `src/AsyncTasks.tsx` の1ファイルだけをコピー**し、対象フォームを `AsyncTasksProvider` で囲みます。Providerは画面・フォームごとに分けてください。Providerを使うHookは、そのProviderの子コンポーネントで呼びます。

```tsx
<AsyncTasksProvider>
  <EditForm />
</AsyncTasksProvider>
```

## インポート

```tsx
import {
  AsyncTasksProvider,
  useAsyncTasks,
  useAfterTasks,
  TrackedInput,
} from "./AsyncTasks";
```

共通Inputに自動登録を組み込む場合はTrackedInputを使わなくても構いません。旧ファイル名のimportは上記に変更してください。ローカルファイルへの依存はなく、React以外の実行時依存はありません。TypeScriptのlibはES2021以上（AggregateError）とDOMが必要です。Next.js App Routerの場合は利用先に合わせてクライアント境界（`"use client"`）を設定してください。

## 普通のbuttonから呼ぶ

```tsx
const { run, busy } = useAfterTasks(
  async () => {
    await save(values);
    // 保存成功後の遷移などもここに書く
  },
  { onError: (error) => setError(String(error)) },
);

<button type="button" onClick={run} disabled={busy}>保存</button>
```

`run` は `() => void` です。実行要求を予約するための関数であり、保存完了をawaitするAPIではありません。DOMイベントはactionへ渡しません。`preventDefault`などは元のイベントハンドラーで同期的に行ってください。

## blurの登録

共通Inputを使う場合、開発者は通常の非同期onBlurを書けます。

```tsx
<TrackedInput taskKey="name" onBlur={async (event) => {
  const input = event.currentTarget.value; // awaitより前に読み取る
  const name = await normalizeName(input);
  setValues(previous => ({ ...previous, name }));
}} />
```

素のinputの場合は登録を明示します。

```tsx
const { register } = useAsyncTasks();
<input onBlur={event => {
  register(handleBlur(event.currentTarget.value), "name");
}} />
```

`register`はPromiseを受け取り、完了・失敗を追跡します。呼び出し前に同期例外が発生する関数は呼び出し側で処理するか、TrackedInputを利用してください。

## フォーカスが残っている場合

Enter送信やブラウザーのフォーカス挙動によってはblurが先に起きません。`beforeWait`に同期的なフォーカス解除を指定できます。ExampleFormに実装しています。

```tsx
beforeWait: () => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && formRef.current?.contains(active)) {
    active.blur();
  }
}
```

ここでのrefはDOM参照用であり、stateの二重管理ではありません。解除対象を当該フォームに限定してください。

## 動作と保証する範囲

1. runがContext単位でロックし、busy=trueにする。
2. beforeWaitを同期実行し、登録済みのPromiseを待つ。待機中の追加も追跡する。
3. Hookのstateを更新して、レンダー後のEffectへ処理を渡す。
4. 新しく渡されたactionを、そのレンダーのstateで実行する。
5. action完了／失敗までbusyを維持してロックを解除する。

同じProvider内の全useAfterTasksがbusyを共有します。ロック中のrunは無視し、保存操作はキューに積みません。複数の入力のPromiseは並行に実行されます。待機中にHookがアンマウントされた場合はactionを実行しません。開始済みのAPI通信は自動キャンセルしません。

blurが通常のsetStateを呼んでからPromiseを完了することを前提にしています。startTransition、Suspenseによる遅延、Effect内で後から更新される値、投げっぱなしのPromiseやタイマーは、この仕組みだけでは更新完了を保証しません。action実行開始後に新規登録された処理も、そのactionの待機対象にはなりません。

actionの開始時に最新のコミット済みレンダーを使います。action自身がawaitしている間に変化したstateを、実行中の同じ関数内で自動的に読み直すものではありません。useCallbackを使う場合は依存配列を正しく設定してください。

待機中の再編集は画面側で抑止します。ExampleFormではreadOnly={busy}を使い、blur開始時点でボタンを消したり無効にしたりはしません。同一項目の非同期処理が重複する場合の古い結果による上書きは、別途世代番号やAbortControllerで防いでください。タスク管理のkeyはエラー管理用で、stateへの古い書き込みを止めるものではありません。

## エラーと再試行

失敗した入力タスクがあるとactionは実行せず、onErrorへ通知します。エラーは次の保存で黙って消えません。同じtaskKeyの新しい登録が成功すると、その項目の失敗を解除します。keyはScope内で入力ごとに一意にしてください。keyを省略すると毎回別タスクとなり、自動的な再試行の対応付けは行いません。

フォームを検証済みの初期状態へ戻すなどの場合だけ、useAsyncTasks().clearErrors()で全失敗を明示的に解除できます。保存するたびに解除しないでください。既に通信中の処理の失敗まで抑止するものではありません。未登録の検証・エラーは別途管理してください。

## 確認

```sh
npm ci
npm run typecheck
npm test
```

React 19の検証用依存関係をpackage-lock.jsonに含めています。既存アプリのpackage.jsonを置き換える必要はありません。

## 追加で考慮すること

| 項目 | 対応方針 |
|---|---|
| 終わらないPromise | タスクや保存APIにアプリ側のタイムアウトを設定する。現状は完了するまでbusyが続く。待機だけ解除して保存を続行しない |
| 同一入力の再編集 | 世代番号による古い結果の破棄、またはAbortControllerをAPI側で実装する。taskKeyはstateの上書きを防がない |
| 入力中のEnter / IME | 日本語変換確定のEnterで誤送信しないよう、実ブラウザーでcomposition状態を考慮する |
| blur時にDOMを変える | 保存ボタンをblur開始直後に削除・disabled化するとclick自体が届かない場合がある。busyはrun開始から適用する |
| Scope内のタスク | 保存前に必要なタスクのみ登録する。定期ポーリングや別画面の取得は登録しない |
| エラー表示 | 入力単独の即時表示は画面側で行う。ContextのonError通知はrunを要求したとき。catchして成功扱いにしない |
| 動的フォーム | 削除した項目のタスクと失敗をどう扱うか決める。現実装はフィールド削除を自動検知しない。clearErrorsは全体解除なので慎重に扱う |
| 元のDOMイベント | action実行時にはイベント配送が終わっている。preventDefaultやイベント値の取得は同期的に行う |
| ユーザー操作権限 | window.open、クリップボード、ファイル選択等は遅延実行するとブラウザーのユーザー操作要件を満たせない場合がある。このHookは主に保存等の業務処理用 |
| 保存の重複 | ローカルの連打防止とは別に、複数タブ・通信再送はサーバー側で冪等性や楽観ロックを検討する |

待機を終えた要求にはレンダー番号を付け、その更新を含むレンダーでのみactionを実行します。タスクの登録世代も確認し、待機完了からEffectまでに追加があれば、完了済みでも改めて待機・再レンダーを経由します。これらは通常のsetStateを対象とした調整であり、Reactの全優先度の更新を強制的に完了させる仕組みではありません。
