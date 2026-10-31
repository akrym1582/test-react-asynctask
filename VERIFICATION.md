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
