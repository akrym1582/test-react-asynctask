# AfterTasksの性能検証

10・100・500入力で、時間とReactのcommit回数、購読通知の配信回数を継続して測ります。既存API・本体実装は変更していません。

## 実行方法

```sh
npm ci
npm run benchmark
node scripts/summarize-benchmark.mjs benchmark-results/current-jsdom.json
npm test
npx playwright install --with-deps chromium firefox webkit
npm run test:browser -- browser-tests/performance.spec.ts
```

`npm run benchmark`はjsdomです。ブラウザーのレイアウト・描画性能は測れません。ブラウザーテストは同じフォームをViteの開発ビルドで操作し、各ブラウザーのJSONをPlaywrightの添付ファイルに残します。CIは成功時も`aftertasks-browser-benchmark`と`aftertasks-jsdom-benchmark`のArtifactsを保存します。

## 測定条件

各条件2回warmup、7回測定。mount・購読設定・unmountを時間と通知数から除外し、StrictModeは使いません。通信時間は共通の遅延Promiseを手動解放して除き、非同期の完了・Reactへの反映は実行します。処理中の追加タスク・取消・IME・例外は既存の機能テストが検証します。

| 条件       | 実行する処理                                                        |
| ---------- | ------------------------------------------------------------------- |
| register   | N件の非同期タスクを登録し、解放後の保存終了まで待機                 |
| blur-all   | 全入力を編集し、focus/blurで確定処理を開始。解放後の保存まで待機    |
| blur-one   | N入力のうち1入力だけを編集・blurし、解放後の保存まで待機            |
| save-dirty | 全入力をdirtyにし、保存による一括確定・待機・最新state参照を確認    |
| state-one  | 1入力のstateだけ変更し、他入力のcommitが0回か確認。保存は実行しない |

入力は`memo`化し、親の配列stateと安定したsetterを使います。編集はfield.changeとsetterを直接呼びます。blurはDOMのfocus/blurで発火させます。人のキー入力・OSのIME・ネットワーク・本番ビルドの応答時間の検証ではありません。

- `registerMs`: 登録の同期部分とそのflushSync。
- `editMs`: dirty化と親state更新、Reactの同期commitまで。配列コピー等のアプリ側の負荷も含みます。
- `blurMs`: blurまたは保存受付の同期部分。save-dirtyでは待機対象の登録も含みます。
- `waitMs`: Promise解放から保存終了・state反映の確認まで。0ms timerによるポーリングと最後の1tickを含みます。
- `totalMs`: 上記の全操作。各列の中央値の和とは一致しない場合があります。
- `notifications`: 公開store.subscribeをラップし、**購読コールバックへ配信した回数の合計**を測定。emit回数ではありません。wait内部が直接登録するlistenerは含みません。計測用ラッパー自体の負荷も含みます。
- `fieldCommits`: 各入力のlayout effect回数。初回mountを除き、ReactでDOMへcommitされた更新を数えます。破棄されたrender試行は数えません。生JSONには入力ごとの配列と親フォームのcommit回数も残ります。

時刻の閾値は共有CIの負荷で変わるため合否にしません。最新stateの保存、1項目変更時の他項目commit=0、1項目変更の通知数上限を合否条件にします。入力UIがすべて共有hasPendingTasks/isRunningを購読するため、保存・タスク有無の切替では全入力のcommitが起きます。

## 改善前との比較を再現する

今回の比較対象は改善直前`c152d1b4b684a72be1f082639bc79cfcd764dece`とmain `eb96bdc88c58b2484fe6f564235f5763e53fee4d`です。src全ファイルのblobを照合し、この間で異なるAfterTasks.tsx/useAfterTasksField.tsだけを改善前へ戻した独立ディレクトリで、同一の依存と測定コードを実行しました。リポジトリへの古い実装の常設コピーは不要です。

PRブランチに測定コードがある状態で、例えば次のように比較できます。作業中のsrcを直接書き換えず、worktreeを使います。

```sh
git worktree add --detach ../aftertasks-before HEAD
git show c152d1b4b684a72be1f082639bc79cfcd764dece:src/AfterTasks.tsx > ../aftertasks-before/src/AfterTasks.tsx
git show c152d1b4b684a72be1f082639bc79cfcd764dece:src/useAfterTasksField.ts > ../aftertasks-before/src/useAfterTasksField.ts
npm --prefix ../aftertasks-before ci
npm run benchmark
BENCH_LABEL=before npm --prefix ../aftertasks-before run benchmark
node scripts/summarize-benchmark.mjs benchmark-results/current-jsdom.json ../aftertasks-before/benchmark-results/before-jsdom.json
```

比較時は同じマシンで順番に実行し、他の重い処理を止めてください。固定順・小試行数のJIT/GCの影響を含むため、数%の差を改善と断定しません。独立storeでは背景タスクをN件置き、hasPendingを10,000回呼び、タスク走査の増加をフォーム側のコストから分けて確認します。

## 実測と残った負荷

[RESULTS.md](./RESULTS.md)にjsdomの実測を記録しています。生の全試行を集計したCSVも同じディレクトリにあります。ローカルの実ブラウザー測定は実行ファイルがなく起動前に失敗し、**未検証**です。React 18のローカル測定・本番ビルド・低速端末・実ネットワークも未検証です。PRのCI結果はローカル測定とは別に確認します。

- 独立storeのhasPending判定は改善前のNに応じた増加が抑えられています。
- 1入力のstate変更では他入力のcommitは0回。blur-oneでは改善前にあった追加の無関係入力commitが減っています。
- 通知はなお全購読者へ配信します。N件の開始・完了でO(N)回通知し、それぞれO(N)購読者がいるため、**全件操作の配信合計はO(N²)**です。500入力のblur-allでは約251万配信でした。snapshot安定化はReactのcommitを抑えても、snapshot確認のコストまでは除きません。
- blur-oneも公開hasPendingTasks/isRunningの切替で全入力がcommitします。現APIでこれらの共有状態を参照できる動作の結果です。
- prepareはdirtyだけを走査しますが、全件dirtyなら開始・完了の通知中にも残ったdirtyの確認が入ります。全件dirtyの一括確定では追加の走査が残る可能性があります。フォーム時間だけでその寄与は分離できていません。

購読経路を公開状態・入力key・内部待機へ分離する案はありますが、内部待機は公開snapshotが同じでも通知を必要とします。単純に通知を削る修正では正しさを保てません。今回の実測だけでは互換性を保つ小さな修正の有効性まで確認できないため、本体には手を加えていません。今回の回帰検証とブラウザーArtifactsを基準に、別の変更として評価できます。

## 購読分離後の測定

上のRESULTS.mdと「残った負荷」はPR #1時点の履歴です。派生実装では共有snapshotと入力keyの通知を分離し、入力Hookの共有状態購読を除去しました。ベンチマークは汎用subscribeに加えてsubscribeSnapshot・入力storeのsubscribeも計数します。新しい結果は[SUBSCRIPTIONS_RESULTS.md](./SUBSCRIPTIONS_RESULTS.md)を参照してください。内部waitの直接listenerは引き続き測定対象外です。全件操作の通知配信は線形になりましたが、親の配列state更新などの処理時間までO(N)になったと断定しません。
