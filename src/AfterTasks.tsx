/**
 * 登録した処理の完了とReactの再レンダーを待ち、更新後のstateで保存などの後続処理を実行します。
 * AfterTasksProvider・タスク登録・useAfterTasksは、この1ファイルだけで利用できます。
 * React以外の実行時依存はありません。
 *
 * 中心ファイルだけで使う基本の流れ:
 * 1. 連携する入力欄と保存ボタンを、同じAfterTasksProviderの配下に配置する。
 * 2. useAfterTasksでregisterAsyncTaskを取得し、onBlurなどで処理を登録する。
 * 3. useAfterTasks(action, { onError })から取得したrunAfterTasksを、保存ボタンのonClickなどへ渡す。
 * 4. runAfterTasksが登録タスクの完了を待ち、再レンダー後のactionを呼ぶ。
 *    同じProvider配下の子孫が登録したタスクと、待機途中に追加されたタスクも対象となる。
 *    blocking:falseの背景処理は保存の待機対象に含めない。
 *
 * 登録とstate反映:
 * - 同期処理・非同期処理とも登録でき、戻り値なしで直接setStateする形でも利用できる。
 * - 非同期処理は必ずawaitするかPromiseをreturnする。未登録のPromiseは自動検出しない。
 * - 直接呼ぶsetStateは取消・期限切れ・置き換え後も実行され得る。
 *   古い結果を反映させたくない場合は、処理から値を返して同期的なonCommitで反映する。
 * - key省略時はUUIDで各登録を独立管理する。同じ固定keyの再登録は先行処理を置き換える。
 *   取消はsignalによる中断要求であり、元のPromiseやサーバー処理を強制終了するものではない。
 * - 失敗すると保存を止める。キー省略時の再試行では、以前の失敗をhandle.clearError()で解除できる。
 *   画面全体の失敗を明示的に解除する場合はclearErrors()を使う。
 *
 * 実行時の注意:
 * - runAfterTasksは既定でフォーカス中の要素をblurする。不要ならblurActiveElement:falseを指定する。
 *   onBlurでは最初のawaitより前にregisterAsyncTaskを呼び、待機対象を確定させる。
 * - isRunningは後続処理の待機・実行中、hasPendingTasksは登録タスクが未完了の状態を表す。
 * - タスク・待機・後続処理のタイムアウトは既定でnull（無期限）。
 * - runAfterTasksはvoid関数。保存後の処理はaction内に書き、await runAfterTasks()では待たない。
 * - actionは更新後のレンダーのstateを読むが、action内のawait後に同じstate変数が自動更新されるわけではない。
 *
 * 任意部品（必要な場合だけ別ファイルから利用する）:
 * - useAfterTasksField.ts: 編集をdirty（未確定）として管理し、blurや保存時にnormalizeしてonCommitへ渡す。
 * - AfterTasksInput.tsx: 上記の入力管理を組み込んだ入力UI。
 * - useLatestCommitted.ts: 最新のcommit済み値を取得するgetter。Providerなしでも利用できる。
 * - useAfterTasksSubmit.ts: formのEnter・IME入力などを扱う送信補助。
 * この中心ファイルから任意部品への依存はなく、通常のinputとonBlurだけでも利用できる。
 *
 * @example
 * const { registerAsyncTask, runAfterTasks, isRunning } = useAfterTasks(
 *   async () => { await save(value); },
 *   { onError: error => setError(String(error)) },
 * );
 * // 入力欄のonBlurから、最初のawaitより前に登録します。
 * const handleBlur = () => {
 *   registerAsyncTask(({ signal }) => normalize(value, { signal }), {
 *     key: "value",
 *     onCommit: setValue,
 *   });
 * };
 * // <input value={value} onChange={e => setValue(e.currentTarget.value)} onBlur={handleBlur} />
 * // <button onClick={runAfterTasks} disabled={isRunning}>保存</button>
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
/** ミリ秒。nullは期限なし。0/負数/NaN/Infinityは指定できません。 */
export type AfterTasksTimeout = number | null;
export type AfterTasksErrorKind =
  "task" | "validation" | "timeout" | "cancelled" | "action";
/**
 * 共通処理のエラー。kindで種類を、detailsで項目や要求を特定できます。
 * @example
 * if (error instanceof AfterTasksError && error.kind === "timeout") {
 *   console.log(error.details.taskKey, "の確定に時間がかかっています");
 * }
 */
export class AfterTasksError extends Error {
  constructor(
    public kind: AfterTasksErrorKind,
    message: string,
    public details: {
      taskKey?: string | symbol;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "AfterTasksError";
  }
}
export type AfterTasksStatus =
  | "pending"
  | "fulfilled"
  | "rejected"
  | "timedOut"
  | "cancelled"
  | "superseded";
/** resultはrejectしない判別可能unionです。待たずに登録しても未処理rejectionを作りません。 */
export type AfterTasksResult<T> =
  | { status: "fulfilled"; value: T }
  | {
      status: Exclude<AfterTasksStatus, "pending" | "fulfilled">;
      error?: unknown;
    };
export type AfterTasksHandle<T> = {
  result: Promise<AfterTasksResult<T>>;
  signal: AbortSignal;
  getStatus: () => AfterTasksStatus;
  cancel: () => void;
  /**
   * この登録の失敗だけを解除します。キー省略時の再試行でも、以前の失敗を解除できます。
   * 他の登録の失敗は残します。取消や自動再実行は行いません。
   * @example
   * // 再試行ボタンで、失敗した登録を解除してから新たに登録します。
   * failedHandle.clearError();
   * const retry = registerAsyncTask(loadValue, { onCommit: setValue });
   */
  clearError: () => void;
};
/** blocking=falseは保存に無関係な背景処理用。送信データを変更する処理には使わないでください。 */
export type AfterTasksOptions<T = unknown> = {
  /**
   * 省略時は自動生成UUIDで独立登録します。keyなしのタスクはすべて待機対象となります。
   * 同じ入力の古い結果を置き換えたい場合だけ、固定の文字列またはsymbolを指定します。
   * 同じkeyを指定して再登録すると、以前の処理を中断要求して結果を無効化します。
   */
  key?: string | symbol;
  /** 省略時true。falseは保存に無関係な背景処理用で、完了待機・保存阻止の対象から外します。 */
  blocking?: boolean;
  /** このタスクの期限（ミリ秒）。省略時はProviderのtaskTimeoutMs、nullなら無期限です。 */
  timeoutMs?: AfterTasksTimeout;
  /**
   * 省略可能。タスクが有効なまま成功した場合に、戻り値を受け取って同期的に実行します。
   * 非同期関数は指定しないでください。取消・期限切れ・置き換え後の古い結果は反映しません。
   * 省略してfactory内で直接setStateしても構いません。戻り値なし（void）の処理も登録できます。
   * ただし、直接呼ぶsetStateはこの仕組みでは止められません。非同期処理がsignalを無視して
   * 続いた場合、取消・期限切れ・置き換え後にも古い値が反映される可能性があります。
   * 古い結果の反映を防ぎたい場合は、factoryから値を返し、このonCommitでsetStateしてください。
   */
  onCommit?: (value: T) => void;
};
/** Provider初期設定。入力・総待機・保存の期限はすべて省略時null（無期限）です。 */
export type AfterTasksConfig = {
  /** タスク1件の既定期限。省略時null（無期限）。登録時のtimeoutMsで上書きできます。 */
  taskTimeoutMs?: AfterTasksTimeout;
  /** 入力確定を待つ総期限の既定値。省略時null（無期限）。Hook側で上書きできます。 */
  waitTimeoutMs?: AfterTasksTimeout;
  /** 保存処理の既定期限。省略時null（無期限）。Hook側で上書きできます。 */
  actionTimeoutMs?: AfterTasksTimeout;
  /** タスクが失敗・期限切れになった時点の同期通知。保存要求がなくても呼ばれます。 */
  onTaskError?: (error: AfterTasksError) => void;
};
export type AfterTasksPhase =
  "idle" | "preparing" | "waiting" | "ready" | "executing";
export type AfterTasksContext = {
  /** 保存期限切れ・Scope破棄等の取消要求。fetch等へ渡します。サーバーの処理停止は保証しません。 */
  signal: AbortSignal;
  /** 1回の保存要求を識別するID。ログ記録・必要に応じたAPI側の重複排除に利用します。 */
  requestId: string;
};
/** 同じProvider内のすべての利用箇所が購読する、読み取り専用の実行状態です。 */
export type AfterTasksSnapshot = Readonly<{
  /** 保存要求を受け付けてから、入力待機・保存処理が終了するまでtrue。入力タスク単独の実行は含みません。 */
  isRunning: boolean;
  /** 未完了の登録タスクが1件以上あればtrue。背景処理も含み、保存actionやdirty入力だけの状態は含みません。 */
  hasPendingTasks: boolean;
  /** idle=要求なし、preparing=準備中、waiting=入力待機、ready=再レンダー待ち、executing=保存中。 */
  phase: AfterTasksPhase;
  /** 現在の保存要求のID。入力タスクのUUIDとは別で、要求がなければnull。 */
  requestId: string | null;
}>;
const idleAction: AfterTasksSnapshot = Object.freeze({
  isRunning: false,
  hasPendingTasks: false,
  phase: "idle" as AfterTasksPhase,
  requestId: null as string | null,
});
function duration(
  value: AfterTasksTimeout | undefined,
  fallback: AfterTasksTimeout,
): AfterTasksTimeout {
  const result = value === undefined ? fallback : value;
  if (result !== null && (!Number.isFinite(result) || result <= 0))
    throw new RangeError("期限には正の有限値かnullを指定してください");
  return result;
}
function report(
  handler: ((error: AfterTasksError) => void) | undefined,
  error: AfterTasksError,
) {
  try {
    handler?.(error);
  } catch (cause) {
    console.error("AfterTasks error handler failed", cause);
  }
}
function synchronous(result: unknown, label: string) {
  if (result && typeof (result as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(result).catch(() => {});
    throw new TypeError(`${label}は同期関数で指定してください`);
  }
}
let sequence = 0;
function requestId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `async-${Date.now()}-${++sequence}`
  );
}

/** 任意機能をタスク待機へ接続するための内部契約です。通常の画面からは利用しません。 */
export type AfterTasksParticipant = {
  /** 待機開始時や再確認時に、まだ登録されていない確定処理を開始します。 */
  prepare: () => void;
  /** 待機が必要な未確定状態を持つ場合はtrueです。 */
  hasPending: () => boolean;
  /** clearErrorsから任意の失敗した処理を再確定します。 */
  retryFailed?: () => void;
  /** Scope破棄時に入力等の所有状態と購読を片付けます。 */
  dispose: () => void;
};
type InternalTask = {
  blocking: boolean;
  cancel: (status: "cancelled" | "superseded") => void;
};
type ActionOwner = {
  id: string;
  controller: AbortController;
  phase: AfterTasksPhase;
};

/**
 * Contextが内部で保持する管理オブジェクトを作ります。
 * 通常の画面では直接呼ばず、Provider + useAfterTasksを使ってください。
 * Reactに依存しない状態管理部分なので、単体テストでは直接使えます。
 * @example
 * const store = createAfterTasksStore({ taskTimeoutMs: 5000 });
 * store.registerAsyncTask(() => loadSomething());
 * await store.wait(); // 成功時だけここに進む。Reactのcommitを待つ用途ではない。
 */
export function createAfterTasksStore(config: AfterTasksConfig = {}) {
  const defaults = {
    taskTimeoutMs: duration(config.taskTimeoutMs, null),
    waitTimeoutMs: duration(config.waitTimeoutMs, null),
    actionTimeoutMs: duration(config.actionTimeoutMs, null),
  };
  const tasks = new Map<string | symbol, InternalTask>();
  let blockingCount = 0;
  const failures = new Map<string | symbol, AfterTasksError>();
  const participants = new Set<AfterTasksParticipant>();
  const listeners = new Set<() => void>();
  const snapshotListeners = new Set<() => void>();
  // タスクの件数だけでは「追加されてすぐ完了した処理」を検出できません。
  // 条件が変わるたびにrevisionを進め、Hook側で再レンダーの必要性を判定します。
  let revision = 0;
  let owner: ActionOwner | null = null;
  let actionSnapshot = idleAction;
  let leases = 0;
  let disposed = false;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const publishAction = () => {
    const next = owner
      ? {
          isRunning: true,
          hasPendingTasks: tasks.size > 0,
          phase: owner.phase,
          requestId: owner.id,
        }
      : tasks.size > 0
        ? { ...idleAction, hasPendingTasks: true }
        : idleAction;
    // 公開状態が同じなら参照を維持し、購読Hookの再レンダーを抑えます。
    // 内部待機と入力状態の購読には、公開状態が同じでも通知が必要です。
    if (
      next.isRunning !== actionSnapshot.isRunning ||
      next.hasPendingTasks !== actionSnapshot.hasPendingTasks ||
      next.phase !== actionSnapshot.phase ||
      next.requestId !== actionSnapshot.requestId
    ) {
      actionSnapshot = next;
      for (const listener of [...snapshotListeners]) listener();
    }
    notify();
  };
  const changed = () => {
    revision++;
    // タスクだけが変わった場合もsnapshotを更新し、登録専用Hookの購読先へ通知します。
    publishAction();
  };
  const assertSuccess = () => {
    if (failures.size)
      throw new AggregateError(
        [...failures.values()],
        "入力処理に失敗しました",
      );
  };
  /**
   * 通信開始前にsignalを準備できるfactory形式。同期throwもタスクの失敗へ変換します。
   * key省略時は自動UUIDで独立登録し、全件を待機します。固定keyの再登録時だけ古い結果を無効化します。
   * @param factory signalを受け取り処理を開始する関数。同期・非同期どちらも指定できます。
   * 値やPromiseを返すほか、直接setStateして何も返さない（void）形でも登録できます。
   * 待機対象の非同期処理は必ずawaitするか、そのPromiseをreturnしてください。
   * Promiseを返さず非同期処理を開始しただけでは、その完了やstate更新を待てません。
   * 直接setStateする場合、その呼び出しは取消・期限切れ・置き換え後も防止できません。
   * 古い結果を反映させたくない場合は、値を返してoptions.onCommitで反映してください。
   * @param options 省略可能。結果を反映する同期onCommit、期限、blocking、必要な場合だけ固定keyを指定します。
   * @returns result（rejectしない結果Promise）、signal、getStatus、cancelを持つハンドル。
   * @example
   * const handle = tasks.registerAsyncTask(({ signal }) =>
   *   fetch("/api/name", { signal }).then(response => response.json()),
   *   { timeoutMs: 5000 },
   * );
   * const result = await handle.result;
   * if (result.status === "fulfilled") console.log(result.value);
   * // handle.cancel() は中断要求です。サーバー側の処理停止までは保証しません。
   * @example
   * // 同期処理・戻り値なし・onCommitなしでも登録できます。
   * tasks.registerAsyncTask(() => {
   *   setValue(normalizeSync(input));
   * });
   * @example
   * // 非同期処理内で直接setStateする場合は、処理全体をawaitさせます。
   * tasks.registerAsyncTask(async ({ signal }) => {
   *   const value = await normalize(input, { signal });
   *   setValue(value); // 取消後などでも呼ばれ得るため、古い結果との競合に注意してください。
   * });
   * @example
   * // 古い結果を防ぐ場合: 値の計算とstateへの反映を分けます。
   * tasks.registerAsyncTask(({ signal }) => normalize(input, { signal }), {
   *   key: "value",
   *   onCommit: setValue, // 取消・期限切れ・同じkeyでの置き換え後は呼びません。
   * });
   */
  function registerAsyncTask<T>(
    factory: (context: { signal: AbortSignal }) => T | Promise<T>,
    options: AfterTasksOptions<T> = {},
  ): AfterTasksHandle<T> {
    if (disposed) throw new Error("AfterTasks scope is disposed");
    const timeout = duration(options.timeoutMs, defaults.taskTimeoutMs);
    // 通常は登録ごとにIDを作り、別の登録を置き換えず全件を待機します。
    // requestId()はcrypto.randomUUIDを使い、非対応環境では時刻と連番で一意にします。
    const key = options.key ?? requestId();
    tasks.get(key)?.cancel("superseded");
    const controller = new AbortController();
    let status: AfterTasksStatus = "pending";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolve!: (result: AfterTasksResult<T>) => void;
    const result = new Promise<AfterTasksResult<T>>((done) => {
      resolve = done;
    });
    const blocking = options.blocking !== false;
    let ownError: AfterTasksError | undefined;
    const finish = (
      next: Exclude<AfterTasksStatus, "pending">,
      value?: T,
      cause?: unknown,
    ) => {
      // 取消・timeout後に元のPromiseが完了しても、二度と結果を反映しません。
      if (status !== "pending") return;
      if (next === "fulfilled") {
        try {
          synchronous(options.onCommit?.(value as T), "onCommit");
        } catch (error) {
          next = "rejected";
          cause = error;
        }
        // onCommitからの再入による取消を尊重する。
        if (status !== "pending") return;
      }
      status = next;
      clearTimeout(timer);
      if (tasks.get(key) === internal) tasks.delete(key);
      if (blocking) blockingCount--;
      let error: AfterTasksError | undefined;
      if (next === "timedOut" || next === "rejected") {
        error = new AfterTasksError(
          next === "timedOut" ? "timeout" : "validation",
          next === "timedOut"
            ? "入力処理がタイムアウトしました"
            : "入力処理に失敗しました",
          { taskKey: key, cause },
        );
        ownError = error;
        if (blocking) failures.set(key, error);
      } else if (next === "fulfilled") failures.delete(key);
      if (next === "cancelled" || next === "superseded" || next === "timedOut")
        controller.abort();
      resolve(
        next === "fulfilled"
          ? { status: next, value: value as T }
          : { status: next, error },
      );
      changed();
      if (error) report(config.onTaskError, error);
    };
    const internal: InternalTask = { blocking, cancel: (next) => finish(next) };
    tasks.set(key, internal);
    if (blocking) blockingCount++;
    changed();
    if (timeout !== null) timer = setTimeout(() => finish("timedOut"), timeout);
    try {
      Promise.resolve(factory({ signal: controller.signal })).then(
        (value) => finish("fulfilled", value),
        (error) => finish("rejected", undefined, error),
      );
    } catch (error) {
      finish("rejected", undefined, error);
    }
    return {
      result,
      signal: controller.signal,
      getStatus: () => status,
      cancel: () => finish("cancelled"),
      clearError: () => {
        // 同じkeyで後から失敗した別登録のエラーは解除しません。
        if (!ownError || failures.get(key) !== ownError) return;
        failures.delete(key);
        changed();
      },
    };
  }
  const prepareParticipants = () =>
    participants.forEach((participant) => participant.prepare());
  const hasPending = () => {
    if (blockingCount > 0) return true;
    for (const participant of participants)
      if (participant.hasPending()) return true;
    return false;
  };
  /**
   * dirty入力を確定し、blockingタスクがなくなるまで購読して待ちます。
   * Promise.allを一度だけ呼ぶ方法と違い、待機途中の追加・削除にも追従します。
   * この関数だけではReactのstate反映待ちは行いません。画面ではuseAfterTasksを使用します。
   */
  async function wait(
    options: { signal?: AbortSignal; timeoutMs?: AfterTasksTimeout } = {},
  ) {
    const timeout = duration(options.timeoutMs, defaults.waitTimeoutMs);
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (error?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        listeners.delete(check);
        options.signal?.removeEventListener("abort", abort);
        if (error !== undefined) reject(error);
        else resolve();
      };
      const abort = () =>
        finish(new AfterTasksError("cancelled", "待機を取り消しました"));
      let checking = false;
      const check = () => {
        if (finished || checking) return;
        checking = true;
        try {
          if (disposed) {
            abort();
            return;
          }
          prepareParticipants();
          if (!hasPending()) {
            assertSuccess();
            finish();
          }
        } catch (error) {
          finish(error);
        } finally {
          checking = false;
        }
      };
      listeners.add(check);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (timeout !== null)
        timer = setTimeout(
          () =>
            finish(
              new AfterTasksError(
                "timeout",
                "入力の確定待機がタイムアウトしました",
              ),
            ),
          timeout,
        );
      if (options.signal?.aborted) abort();
      else check();
    });
  }
  const store = {
    defaults,
    registerAsyncTask,
    wait,
    hasPending,
    assertSuccess,
    /** 全体エラーを解除し、接続された任意機能へ再確定を依頼します。通常は項目の再編集で回復します。 */
    clearErrors() {
      failures.clear();
      participants.forEach((participant) => participant.retryFailed?.());
      changed();
    },
    /** @internal 任意機能が持つ未確定状態の変更を、待機処理と購読先へ通知します。 */
    notifyChange: changed,
    /**
     * @internal 任意機能の編集・破棄時に、そのタスクだけのエラーを解除します。
     * 中間状態で待機を完了させないよう、変更通知は任意機能が状態更新後にnotifyChangeで行います。
     */
    clearTaskError(key: string | symbol) {
      failures.delete(key);
    },
    /**
     * @internal 任意機能を待機・再確定・Scope破棄へ接続します。
     * coreは入力UIの具体的な状態や世代管理を持たず、この契約だけを呼びます。
     */
    registerParticipant(participant: AfterTasksParticipant) {
      if (disposed) throw new Error("AfterTasks scope is disposed");
      participants.add(participant);
      changed();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        participants.delete(participant);
        changed();
      };
    },
    cancelInputs() {
      for (const task of [...tasks.values()])
        if (task.blocking) task.cancel("cancelled");
    },
    getRevision: () => revision,
    /** @internal 公開状態が変わったときだけReactへ通知します。 */
    subscribeSnapshot(listener: () => void) {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => actionSnapshot,
    /** 待機・保存処理中。登録した入力タスクだけが動いている間はfalseです。 */
    get isRunning() {
      return actionSnapshot.isRunning;
    },
    /**
     * 未完了の登録タスクが1件でもあればtrue。blocking:falseの背景処理も含みます。
     * 未確定入力(dirty)や保存actionだけの実行は含みません。
     * 取消・期限切れは管理対象から外れるため、元のPromiseが続いていてもfalseへ戻ります。
     */
    get hasPendingTasks() {
      return actionSnapshot.hasPendingTasks;
    },
    beginAction(): ActionOwner | null {
      if (owner || disposed) return null;
      owner = {
        id: requestId(),
        controller: new AbortController(),
        phase: "preparing",
      };
      publishAction();
      return owner;
    },
    setPhase(current: ActionOwner, phase: AfterTasksPhase) {
      if (owner === current) {
        current.phase = phase;
        publishAction();
      }
    },
    release(current: ActionOwner) {
      if (owner === current) {
        owner = null;
        publishAction();
      }
    },
    attach() {
      leases++;
      disposed = false;
      return () => {
        leases--;
        // StrictModeの直後の再接続を許す。実unmountの副作用は各field/hookが先に無効化。
        queueMicrotask(() => {
          if (leases) return;
          disposed = true;
          for (const participant of [...participants]) participant.dispose();
          participants.clear();
          for (const task of [...tasks.values()]) task.cancel("cancelled");
          owner?.controller.abort();
          changed();
          listeners.clear();
          snapshotListeners.clear();
        });
      };
    },
  };
  return store;
}
export type AfterTasksStore = ReturnType<typeof createAfterTasksStore>;
/** actionを指定したuseAfterTasksから取得できる実行操作と状態です。 */
export type AfterTasksExecution = AfterTasksSnapshot & {
  /**
   * イベント用の実行予約関数。自動blurとbeforeWaitを行い、タスク完了・state反映後にactionを呼びます。
   * 同じProviderの実行中の重複要求は受け付けません。戻り値はvoidで、awaitでは完了を待てません。
   * @example <button onClick={runAfterTasks} disabled={isRunning}>保存</button>
   */
  runAfterTasks: () => void;
};
const AfterTasksStoreContext = createContext<AfterTasksStore | null>(null);
/**
 * フォームごとに置く管理範囲です。この範囲内の入力を待ち、保存操作を1つに制限します。
 * configはScope作成時に固定します。変更にはProviderをkeyで再作成してください。
 * @example
 * // 期限を省略すると、入力・確定待機・保存をすべて無期限で待ちます。
 * <AfterTasksProvider>
 *   <EditForm />
 * </AfterTasksProvider>
 */
export function AfterTasksProvider({
  children,
  ...config
}: AfterTasksConfig & { children: ReactNode }) {
  const [store] = useState(() => createAfterTasksStore(config));
  useCommitEffect(() => store.attach(), [store]);
  return (
    <AfterTasksStoreContext.Provider value={store}>
      {children}
    </AfterTasksStoreContext.Provider>
  );
}
/**
 * タスク登録・待機後の実行・共有状態を取得する公開Hookです。
 * 引数なしでは登録とisRunning/hasPendingTasksの参照に利用できます。
 * actionとoptionsを渡すとrunAfterTasksも取得できます。保存処理はHookの引数に定義し、
 * onClick={runAfterTasks}で実行します。actionは待機後の新しいレンダーのstateを参照します。
 * isRunningは待機/保存中、hasPendingTasksは未完了の登録タスクがある状態です。保存失敗はonErrorへ通知します。
 * runAfterTasksはvoid関数です。保存後の処理はaction内へ書きます。
 * Promiseの全自動検出は行いません。
 * @example
 * const { registerAsyncTask, runAfterTasks, isRunning } = useAfterTasks(
 *   context => save(values, context), { onError: console.error },
 * );
 * return <button onClick={runAfterTasks} disabled={isRunning}>保存</button>;
 * @example
 * const tasks = useAfterTasks();
 * tasks.registerAsyncTask(({ signal }) => fetch("/api/suggestions", { signal }), {
 *   blocking: false, // 保存対象のデータとは無関係な背景処理
 * });
 */
export function useAfterTasks(): AfterTasksStore;
/**
 * @param action 入力タスク完了と再レンダー後に実行する保存処理。最新レンダーのstateを参照します。
 * 引数context.signalは取消要求、context.requestIdは保存要求の識別子です。通信層まで渡してください。
 * action内でawaitした後も同じclosureのstateが自動更新されるわけではありません。
 * @param options 自動フォーカス解除・準備処理・期限・エラー通知の設定。onErrorは必須です。
 * @returns 登録操作、runAfterTasks、共有状態。runAfterTasksはvoidを返します。
 */
export function useAfterTasks(
  action: (context: AfterTasksContext) => void | Promise<void>,
  options: AfterTasksRunOptions,
): AfterTasksStore & AfterTasksExecution;
export function useAfterTasks(
  action?: (context: AfterTasksContext) => void | Promise<void>,
  options?: AfterTasksRunOptions,
) {
  const store = useContext(AfterTasksStoreContext);
  if (!store) throw new Error("AfterTasksProviderが必要です");
  // 引数の有無でHookを条件呼び出ししません。登録だけの利用でも同じ順序で呼びます。
  const execution = useAfterTasksExecution(
    store,
    action,
    options ?? registrationOptions,
  );
  // 入力Hookの購読・mountを安定させるため、登録だけの利用では同じstoreを返します。
  return action ? { ...store, ...execution } : store;
}
/** @internal 任意の入力Hook用。状態を購読せず、Providerのstoreを取得します。 */
export function useAfterTasksStoreInternal(): AfterTasksStore {
  const store = useContext(AfterTasksStoreContext);
  if (!store) throw new Error("AfterTasksProviderが必要です");
  return store;
}
const registrationOptions: AfterTasksRunOptions = { onError: console.error };
// coreのエラー通知・準備オプションを、破棄されたレンダーから読まないための内部getterです。
// 公開の任意Hook(useLatestCommitted.ts)をimportせず、中心ファイル単独で動作させます。
function useCommittedOptions<T>(value: T): () => T {
  const ref = useRef(value);
  useCommitEffect(() => {
    ref.current = value;
  });
  return useCallback(() => ref.current, []);
}
/** useAfterTasksの第2引数。保存要求ごとの準備・期限・エラー通知を設定します。 */
export type AfterTasksRunOptions = {
  /**
   * 必須。自動blur・beforeWait・入力待機・actionの失敗を通知します。
   * エラー表示などを同期的に行ってください。入力処理の失敗はAggregateErrorになる場合があります。
   * API側で処理済みのエラーはaction内でcatchして完了させれば、この通知は行いません。
   */
  onError: (error: unknown) => void;
  /**
   * 省略時true。runAfterTasks受付後、beforeWaitより先にフォーカス中のHTML要素へblur()します。
   * Enter送信などで入力欄にフォーカスが残っていても、onBlurからタスクを登録させるためです。
   * blur()自体は非同期処理を待ちません。onBlurでは最初のawaitより前にタスクを登録してください。
   * 対象はdocument.activeElementで、ProviderのDOM範囲には限定されません。
   * 別フォーム・ダイアログの入力や保存ボタンからもフォーカスが外れる場合があります。
   * フォーカス維持や対象限定が必要ならfalseにし、必要に応じbeforeWaitで対象だけblurします。
   * useAfterTasksFieldはfalseでも未確定入力を自動確定します。SSRではDOM操作を行いません。
   * iframe・Shadow DOM内部を再帰的に探索する機能ではありません。
   */
  blurActiveElement?: boolean;
  /**
   * 任意の同期準備処理。自動blurの後、入力タスクの待機開始前に呼びます。
   * エラー表示のクリアや追加タスクの登録に使います。async関数は指定しないでください。
   * この処理でthrowするとonErrorへ通知し、保存を開始せずisRunningを解除します。
   */
  beforeWait?: () => void;
  /**
   * 入力確定を待つ総期限（ミリ秒）。runAfterTasks受付時から計測します。
   * 省略時はProviderのwaitTimeoutMs（既定null・無期限）、nullなら無期限です。
   * 超過時は保存を開始せず入力処理へ取消を要求し、isRunningを解除します。
   * JavaScriptの同期処理を途中で強制終了することはできません。
   */
  waitTimeoutMs?: AfterTasksTimeout;
  /**
   * action開始から保存結果を待つ期限（ミリ秒）。入力待機の時間は含みません。
   * 省略時はProviderのactionTimeoutMs（既定null・無期限）、nullなら無期限です。
   * 超過時はsignalで中断を要求し、onErrorへtimeoutを通知します。
   * 元のactionが実際に完了・失敗するまでisRunningを維持します。signalを無視する処理は強制停止できません。
   * 保存結果の確認や再送判断はAPI呼び出し側で行ってください。共通側の自動再送はありません。
   */
  actionTimeoutMs?: AfterTasksTimeout;
};
/**
 * タスク完了と再レンダーを経由してactionを実行します。
 * runAfterTasksはイベント用のvoid関数で、await runAfterTasks()では保存完了を待てません。
 * isRunningは待機/保存中、hasPendingTasksは未完了の登録タスクがある状態です。保存失敗はonErrorへ通知します。
 * action内のawait後に同じclosureのstateが自動更新されるわけではありません。
 * @example
 * const { runAfterTasks, isRunning } = useAfterTasks(async ({ signal, requestId }) => {
 *   await save(values, { signal, requestId });
 *   navigate("/complete"); // 保存成功後の処理もこの中へ
 * }, { onError: error => setError(String(error)) });
 * return <button onClick={runAfterTasks} disabled={isRunning}>保存</button>;
 */
function useAfterTasksExecution(
  store: AfterTasksStore,
  action: ((context: AfterTasksContext) => void | Promise<void>) | undefined,
  options: AfterTasksRunOptions,
): AfterTasksExecution {
  const snapshot = useSyncExternalStore(
    store.subscribeSnapshot,
    store.getSnapshot,
    () => idleAction,
  );
  const getOptions = useCommittedOptions(options);
  const waitTimeout = duration(
    options.waitTimeoutMs,
    store.defaults.waitTimeoutMs,
  );
  const actionTimeout = duration(
    options.actionTimeoutMs,
    store.defaults.actionTimeoutMs,
  );
  type Request = {
    owner: ActionOwner;
    revision: number;
    tasks: number;
    active: boolean;
    timer?: ReturnType<typeof setTimeout>;
    started: boolean;
    notified: boolean;
  };
  const pending = useRef<Request | null>(null);
  const sequence = useRef(0);
  // stateを1回更新し、その番号を持つ新しいレンダーでのみactionを起動します。
  // refの値だけを変えて古いEffectから起動すると、古いstateを読んでしまいます。
  const [revision, setRevision] = useState(0);
  const fail = useCallback(
    (current: Request, error: unknown) => {
      if (!current.active || current.notified) return;
      current.notified = true;
      try {
        getOptions().onError(error);
      } catch (cause) {
        console.error(cause);
      }
    },
    [getOptions],
  );
  useCommitEffect(
    () => () => {
      const current = pending.current;
      if (!current) return;
      current.active = false;
      clearTimeout(current.timer);
      pending.current = null;
      current.owner.controller.abort();
      // 保存前ならその場で解除し、開始済みなら元actionのfinallyで解除します。
      if (!current.started) store.release(current.owner);
    },
    [store],
  );
  // ここではactionを呼びません。完了を次のレンダーへ渡すことが重要です。
  const prepare = useCallback(
    (current: Request) => {
      void store
        .wait({ signal: current.owner.controller.signal, timeoutMs: null })
        .then(
          () => {
            if (!current.active || pending.current !== current) return;
            current.tasks = store.getRevision();
            current.revision = ++sequence.current;
            store.setPhase(current.owner, "ready");
            setRevision(current.revision);
          },
          (error) => {
            if (!current.active || pending.current !== current) return;
            clearTimeout(current.timer);
            fail(current, error);
            current.active = false;
            pending.current = null;
            store.release(current.owner);
          },
        );
    },
    [store, fail],
  );
  const getExecution = useCommittedOptions({ enabled: !!action, waitTimeout });
  const runAfterTasks = useCallback(() => {
    const { enabled, waitTimeout } = getExecution();
    if (!enabled) return;
    const owner = store.beginAction();
    if (!owner) return;
    const current: Request = {
      owner,
      revision: -1,
      tasks: -1,
      active: true,
      started: false,
      notified: false,
    };
    pending.current = current;
    if (waitTimeout !== null)
      current.timer = setTimeout(() => {
        if (!current.active || current.started) return;
        fail(
          current,
          new AfterTasksError(
            "timeout",
            "入力の確定待機がタイムアウトしました",
            { requestId: owner.id },
          ),
        );
        current.active = false;
        pending.current = null;
        owner.controller.abort();
        store.cancelInputs();
        store.release(owner);
      }, waitTimeout);
    try {
      const currentOptions = getOptions();
      // 重複要求の排除後にblurします。blurによる再入でも二重保存を開始させません。
      // document参照は実行時だけに限定し、SSRから呼ばれても参照エラーを起こしません。
      if (
        currentOptions.blurActiveElement !== false &&
        typeof document !== "undefined"
      ) {
        const active = document.activeElement;
        if (typeof HTMLElement !== "undefined" && active instanceof HTMLElement)
          active.blur();
      }
      if (!current.active || pending.current !== current) return;
      synchronous(currentOptions.beforeWait?.(), "beforeWait");
      store.setPhase(owner, "waiting");
      prepare(current);
    } catch (error) {
      clearTimeout(current.timer);
      fail(current, error);
      current.active = false;
      pending.current = null;
      store.release(owner);
    }
  }, [store, getExecution, getOptions, fail, prepare]);
  useEffect(() => {
    const current = pending.current;
    if (
      !current ||
      !current.active ||
      current.started ||
      current.revision !== revision
    )
      return;
    if (current.tasks !== store.getRevision() || store.hasPending()) {
      current.revision = -1;
      prepare(current);
      return;
    }
    current.started = true;
    clearTimeout(current.timer);
    store.setPhase(current.owner, "executing");
    if (actionTimeout !== null)
      current.timer = setTimeout(() => {
        if (!current.active) return;
        // 中断を要求し通知します。元actionが終了するまでisRunningと実行ロックは維持します。
        current.owner.controller.abort();
        fail(
          current,
          new AfterTasksError("timeout", "保存処理がタイムアウトしました", {
            requestId: current.owner.id,
          }),
        );
      }, actionTimeout);
    void (async () => {
      try {
        store.assertSuccess();
        if (!action) throw new Error("保存処理が指定されていません");
        await action({
          signal: current.owner.controller.signal,
          requestId: current.owner.id,
        });
      } catch (error) {
        fail(current, error);
      } finally {
        clearTimeout(current.timer);
        if (pending.current === current) pending.current = null;
        current.active = false;
        store.release(current.owner);
      }
    })();
  }, [revision, action, actionTimeout, store, fail, prepare]);
  return {
    /** 保存を予約します。登録タスクとstate反映を待ってから、最新レンダーのactionを1回実行します。 */
    runAfterTasks,
    /** 保存要求の待機・実行中。保存ボタンのdisabledにはisRunningを使います。 */
    isRunning: snapshot.isRunning,
    /** 登録タスクの処理中表示用。blur直後のclickを妨げないよう、保存ボタンのdisabledには使いません。 */
    hasPendingTasks: snapshot.hasPendingTasks,
    /** 準備・入力待機・保存実行など、現在の段階を表示・診断するための値です。 */
    phase: snapshot.phase,
    /** この保存要求を識別するID。ログや必要に応じたAPI側の重複排除へ渡します。要求がなければnullです。 */
    requestId: snapshot.requestId,
  };
}
