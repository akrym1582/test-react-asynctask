# 検証結果

## 現在の責務

共通部品は登録タスクの待機、state反映後のaction実行、エラー通知、実行状態の管理を担当します。保存結果の分類・照会・再送判断はAPI呼び出し側へ任せます。reconcile・isResultUnknown・UncertainActionError・結果照会用UIは削除しました。

APIがthrow/rejectした場合はonErrorへ通知し、action終了後にisRunningを解除します。API側でcatchして処理済みなら、共通側は再通知しません。保存期限ではsignalで中断を要求してonErrorへtimeoutを通知し、元のactionが実際に終了するまでisRunningを維持します。元処理が終了すれば再実行できます。

## ローカル実行済み

| 検証       | 結果                                                          |
| ---------- | ------------------------------------------------------------- |
| ESLint     | 成功、警告0件                                                 |
| Prettier   | 整形・チェック成功                                            |
| TypeScript | 型チェック成功                                                |
| Vitest     | 57件成功                                                      |
| コピー配布 | 中心単独・入力Hook・入力UI・getter単独・送信補助の5構成で成功 |
| Vite       | 本番ビルド成功                                                |

結果照会の旧テストは、新しい責務に対応する保存期限・保存中unmount・API側のエラー処理の検証へ置き換えました。削除したAPIが型としても利用できないことをコピー検証で確認しています。

## 確認している主な動作

- 非同期blurの処理中にclickが届いても、完了前には保存せず、onCommitのstate反映後に更新済みの値で1回だけ保存すること。通常の先行blurと、clickからの自動blurの両方をStrictMode下で検証します。
- key省略のUUID登録が互いを置き換えず、別の子孫から登録したタスクと待機途中に追加されたタスクも全件待機すること。
- hasPendingTasksが未完了の登録タスクを示し、isRunningとは独立して全子孫に共有されること。成功・失敗・取消・期限切れで状態が解除されること。
- 期限省略時は入力・総待機・保存とも無期限であり、有限期限と個別null上書きも使えること。
- 入力の再編集・取消・期限切れ・unmount後の古い結果を反映しないこと。項目別のエラー管理、再確定、動的な入力の破棄が動くこと。
- 最新値getterがcommit済みの値だけを読み、Suspenseで未確定の値を公開しないこと。
- SSRでDOM参照エラー・Effect警告・action開始がないこと。
- 日本語のテスト名と「確認する状況」「期待する結果」の説明が、単体・結合・ブラウザーテストにあること。

## CIと別途必要な確認

[GitHub Actions](https://github.com/akrym1582/test-react-asynctask/actions/workflows/test.yml)ではReact 18/19それぞれでlint・整形・型・全テスト・コピー検証を実行します。ブラウザージョブはChromium/Firefox/WebKitで4ケースずつ、計12件を実行します。

この作業環境の実ブラウザー起動には取得・起動上の制約があるため、ブラウザーの成功はCIで確認します。Windows/macOSの実OSの日本語IME、実バックエンドのエラー処理や重複排除、Portal/Shadow DOM・利用先の画面遷移との結合は別途確認が必要です。合成compositionイベントやメモリ上のAPI例を、それらの検証済みとは扱いません。

## 状態名の統一

保存要求の待機・実行中はisRunning、未完了の登録タスクありはhasPendingTasksへ統一しました。ソース・コメント・サンプル・テスト・READMEを更新し、旧プロパティが型として利用できないこともコピー検証で確認しました。

## AfterTasksへの名称統一

中心ファイル・Provider・HookをAfterTasks.tsx / AfterTasksProvider / useAfterTasksへ統一しました。公開型、内部の実行Hook、任意の入力Hook・入力UI・送信補助、対応するテストファイル、コピー配布検証、README、AGENTS.mdも同じ名称に更新しています。登録・実行・状態の操作名はregisterAsyncTask / runAfterTasks / isRunning / hasPendingTasksを維持します。

名称統一後も全57件、lint・整形・型チェック・5構成コピー検証・本番ビルドが成功しました。旧Hook・Provider・型名が利用できないこともコピー検証で確認しています。

## レビュー後の性能改善

- 公開snapshotの参照を状態変更時だけ更新し、pending件数のみの変化では購読コンポーネントが再描画されないことをテストしました。
- blockingタスクは件数、任意入力Hookはdirty/pending集合で管理し、待機確認時の全タスク・全入力走査を削減しました。購読通知自体は待機と入力表示のため維持しています。
- runAfterTasksの参照がstate変更後も同一で、保存処理は最新stateを読むことをテストしました。
- 個別clearErrorの解除と、古いハンドルが後続登録の失敗を解除しないことをテストしました。
- 型チェック、単体・結合テスト61件、コピー検証5構成が成功しました。大規模画面の実ブラウザー時間計測は未実施です。
- 同じキーの順次実行は追加しません。同じキーは従来どおり置き換えます。

## 大量入力フォームのベンチマーク（2026-11-01）

- 対象main: `eb96bdc88c58b2484fe6f564235f5763e53fee4d`。改善前: `c152d1b4b684a72be1f082639bc79cfcd764dece`。
- Node v24.22.1 / React 19.3.1 / jsdom 26.1.0 / Linux。既存のローカル依存を再利用し、ロックファイルは変更していません。このセッションでnpm ciの再取得はしていません。
- 10/100/500入力、登録・全項目blur・1項目blur・dirty保存・1項目state更新を、各2回warmup後7回測定。改善前と順番に同じコードを実行しました。
- 最新stateの保存を確認。1項目state更新時は他項目のcommit=0、通知配信は2N+1回。全件操作では全購読者への通知によるO(N²)の配信合計が残ります。
- ローカル: 単体テスト64件、benchmark 1件（各実装）、lint / format:check / typecheck / コピー5構成 / buildが成功。
- ローカルChromium測定はブラウザー実行ファイル不在により起動前に失敗。Chromium/Firefox/WebKitの実ブラウザー時間は**未検証**。旧FirefoxのEnter送信失敗を今回の未解決不具合とは扱っていません。
- React 18のローカル性能、本番ビルド、実OSのIME、実通信、低速端末は未検証。
- ブラウザーとjsdomのJSONをCIで保存する構成を追加。CIの結果はPRの最新コミットで別途確認します。
- 手順・測定定義・残った負荷: [benchmarks/README.md](./benchmarks/README.md)。実測値: [benchmarks/RESULTS.md](./benchmarks/RESULTS.md)。各試行の集計前の時間とカウンターは`benchmarks/samples.csv`/`store-samples.csv`。

## 購読分離（PR #1からの派生）

内部待機・汎用subscribeは従来どおり全変更を通知します。Reactの共有状態購読はsubscribeSnapshotへ、入力Hookはkey別購読へ分離しました。入力Hookは状態購読を伴わない内部store取得Hookを使います。中心ファイルのReact以外への依存は追加していません。

ローカル66テスト、型、lint、整形、コピー5構成、build、jsdomベンチマークが成功。keyの複数購読・解除・再mount、共有snapshot不変時にも内部通知が届くこと、1項目blurで他項目commit=0、全条件の通知数が5N+30以内であることを回帰検証します。

500項目blur-allは前回375.302ms/2,508,510配信から、今回81.175ms/1,513配信。入力commitは4,000→2,000。blur-oneは82.483ms/3,002commitから12.224ms/4commitでした。jsdom・7回中央値であり、実ブラウザー速度は未検証です。1項目state更新は今回6.496msと前回3.074msより遅い試行結果で、全条件の高速化は主張しません。

計測は新しい共有状態・key別購読も含めて配信数を合算しています。前回はその購読が汎用subscribeに集約されていました。内部waitの直接listenerは両方とも含みません。時刻は同一環境でも別実行のため参考値です。詳細は[購読分離の結果](./benchmarks/SUBSCRIPTIONS_RESULTS.md)。前節とRESULTS.mdは分離前の履歴です。

## 状態表示Hookのファイル分離

useAfterTasksFieldStateをsrc/useAfterTasksFieldState.tsへ移動しました。対応テストはtests/useAfterTasksFieldState.test.tsxです。入力UI側から状態購読のケースを移し、66件の検証内容を維持しています。コピー検証は入力Hook単独と状態表示Hookを分けた6構成です。import先とREADME・AGENTS.mdも更新しました。

## 入力Hookと内部storeの分離

useAfterTasksField.tsはReact接続のみとし、管理本体をafterTasksFieldStore.tsへ移動しました。Hookテスト3件、storeテスト6件に振り分け、全66件を維持。型・lint・整形・コピー6構成・buildが成功。コピー構成表と内部参照先を更新しました。
