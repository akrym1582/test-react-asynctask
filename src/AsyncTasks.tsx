/**
 * Reactの非同期入力確定を、保存などのイベント処理より先に完了させる共通部品です。
 * この1ファイルをコピーすれば利用できます。React以外の実行時依存はありません。
 *
 * 基本の流れ:
 * 1. useAsyncField（またはTrackedInput）が編集をdirty（未確定）として記録する。
 * 2. blurまたはrunでnormalizeを開始する。
 * 3. 最新の編集の結果だけをonCommitでReactのstateへ反映する。
 * 4. useAfterTasksが再レンダーを経由し、新しいstateを参照するactionを呼ぶ。
 *
 * 注意: 任意の古いonBlurの中で直接呼ばれたsetStateは取り消せません。
 * 競合防止が必要な入力は normalize/onCommit 形式を使ってください。
 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const useCommitEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
/** ミリ秒。nullは期限なし。0/負数/NaN/Infinityは指定できません。 */
export type Timeout = number | null;
export type ErrorKind =
  | "task"
  | "validation"
  | "timeout"
  | "cancelled"
  | "action"
  | "uncertain";
/**
 * 共通処理のエラー。kindで種類を、detailsで項目や要求を特定できます。
 * @example
 * if (error instanceof AsyncTaskError && error.kind === "timeout") {
 *   console.log(error.details.taskKey, "の確定に時間がかかっています");
 * }
 */
export class AsyncTaskError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string,
    public details: {
      taskKey?: string | symbol;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "AsyncTaskError";
  }
}
/** Adapterが保存結果を確定できない場合にthrowする。 */
export class UncertainActionError extends AsyncTaskError {
  constructor(cause?: unknown) {
    super("uncertain", "保存結果を確認できません", { cause });
  }
}
export type TaskStatus =
  | "pending"
  | "fulfilled"
  | "rejected"
  | "timedOut"
  | "cancelled"
  | "superseded";
/** resultはrejectしない判別可能unionです。待たずに登録しても未処理rejectionを作りません。 */
export type TaskResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: Exclude<TaskStatus, "pending" | "fulfilled">; error?: unknown };
export type TaskHandle<T> = {
  result: Promise<TaskResult<T>>;
  signal: AbortSignal;
  getStatus: () => TaskStatus;
  cancel: () => void;
};
/** blocking=falseは保存に無関係な背景処理用。送信データを変更する処理には使わないでください。 */
export type TaskOptions<T = unknown> = {
  blocking?: boolean;
  timeoutMs?: Timeout;
  /** 最新かつ有効な処理に限り同期実行。非同期関数は禁止。 */
  onCommit?: (value: T) => void;
};
/** Provider初期設定。入力15秒、総待機30秒、保存30秒が既定です。 */
export type TasksConfig = {
  taskTimeoutMs?: Timeout;
  waitTimeoutMs?: Timeout;
  actionTimeoutMs?: Timeout;
  onTaskError?: (error: AsyncTaskError) => void;
};
export type ActionPhase =
  | "idle"
  | "preparing"
  | "waiting"
  | "ready"
  | "executing"
  | "uncertain";
export type ActionContext = { signal: AbortSignal; requestId: string };
/** 入力の見た目に利用する状態。dirtyは「編集中で、まだ確定していない」を意味します。 */
export type FieldSnapshot = Readonly<{
  phase: "clean" | "dirty" | "pending" | "error" | "disposed";
  error?: unknown;
}>;
const cleanField: FieldSnapshot = Object.freeze({ phase: "clean" });
const idleAction: Readonly<{
  busy: boolean;
  blocked: boolean;
  phase: ActionPhase;
  requestId: string | null;
}> = Object.freeze({
  busy: false,
  blocked: false,
  phase: "idle" as ActionPhase,
  requestId: null as string | null,
});
function duration(value: Timeout | undefined, fallback: Timeout): Timeout {
  const result = value === undefined ? fallback : value;
  if (result !== null && (!Number.isFinite(result) || result <= 0))
    throw new RangeError("期限には正の有限値かnullを指定してください");
  return result;
}
function report(
  handler: ((error: AsyncTaskError) => void) | undefined,
  error: AsyncTaskError,
) {
  try {
    handler?.(error);
  } catch (cause) {
    console.error("AsyncTasks error handler failed", cause);
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

type FieldConfig = {
  normalize: (
    value: string,
    context: { signal: AbortSignal },
  ) => Promise<string> | string;
  onCommit: (value: string) => void;
  timeoutMs?: Timeout;
};
type Field = {
  change: (value: string) => void;
  reset: (value: string) => void;
  sync: (value: string) => void;
  commit: (retry?: boolean) => void;
  dispose: () => void;
  snapshot: () => FieldSnapshot;
};
type InternalTask = {
  blocking: boolean;
  cancel: (status: "cancelled" | "superseded") => void;
};
type ActionOwner = {
  id: string;
  controller: AbortController;
  settled: boolean;
  uncertain: boolean;
  phase: ActionPhase;
};

/**
 * Contextが内部で保持する管理オブジェクトを作ります。
 * 通常の画面では直接呼ばず、Provider + useAsyncTasksを使ってください。
 * Reactに依存しない状態管理部分なので、単体テストでは直接使えます。
 * @example
 * const store = createTaskStore({ taskTimeoutMs: 5000 });
 * store.register(loadSomething(), "input");
 * await store.wait(); // 成功時だけここに進む。Reactのcommitを待つ用途ではない。
 */
export function createTaskStore(config: TasksConfig = {}) {
  const defaults = {
    taskTimeoutMs: duration(config.taskTimeoutMs, 15000),
    waitTimeoutMs: duration(config.waitTimeoutMs, 30000),
    actionTimeoutMs: duration(config.actionTimeoutMs, 30000),
  };
  const tasks = new Map<string | symbol, InternalTask>();
  const failures = new Map<string | symbol, AsyncTaskError>();
  const fields = new Map<string, Field>();
  const listeners = new Set<() => void>();
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
  const changed = () => {
    revision++;
    notify();
  };
  const publishAction = () => {
    actionSnapshot = owner
      ? {
          busy: !owner.uncertain,
          blocked: owner.uncertain,
          phase: owner.phase,
          requestId: owner.id,
        }
      : idleAction;
    notify();
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
   * 同じkeyの旧処理はsuperseded（新しい処理で置換された）にして結果を無効化します。
   * @example
   * const handle = tasks.track("name", ({ signal }) =>
   *   fetch("/api/name", { signal }).then(response => response.json()),
   *   { timeoutMs: 5000 },
   * );
   * const result = await handle.result;
   * if (result.status === "fulfilled") console.log(result.value);
   * // handle.cancel() は中断要求です。サーバー側の処理停止までは保証しません。
   */
  function track<T>(
    key: string | symbol,
    factory: (context: { signal: AbortSignal }) => T | Promise<T>,
    options: TaskOptions<T> = {},
  ): TaskHandle<T> {
    if (disposed) throw new Error("AsyncTasks scope is disposed");
    const timeout = duration(options.timeoutMs, defaults.taskTimeoutMs);
    tasks.get(key)?.cancel("superseded");
    const controller = new AbortController();
    let status: TaskStatus = "pending";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolve!: (result: TaskResult<T>) => void;
    const result = new Promise<TaskResult<T>>((done) => {
      resolve = done;
    });
    const blocking = options.blocking !== false;
    const finish = (
      next: Exclude<TaskStatus, "pending">,
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
      let error: AsyncTaskError | undefined;
      if (next === "timedOut" || next === "rejected") {
        error = new AsyncTaskError(
          next === "timedOut" ? "timeout" : "validation",
          next === "timedOut"
            ? "入力処理がタイムアウトしました"
            : "入力処理に失敗しました",
          { taskKey: key, cause },
        );
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
    };
  }
  /**
   * 入力1個の寿命と世代を管理します。fieldインスタンスが所有者tokenの役割も持ちます。
   * 同じkeyで新しい入力がmountされても、古いcleanupは新しい入力を削除できません。
   */
  function mountField(
    key: string,
    value: string,
    getConfig: () => FieldConfig,
  ): Field {
    if (fields.has(key)) throw new Error(`taskKeyが重複しています: ${key}`);
    let draft = value;
    let generation = 0;
    let alive = true;
    let handle: TaskHandle<string> | undefined;
    let snapshot: FieldSnapshot = cleanField;
    const set = (next: FieldSnapshot) => {
      snapshot = next;
      changed();
    };
    const reset = (input: string) => {
      // blur時では遅いため、編集した瞬間に世代を変えます。
      // これにより「Bを入力中なのにAの検索結果が戻って上書きする」ことを防ぎます。
      generation++;
      handle?.cancel();
      handle = undefined;
      draft = input;
      failures.delete(key);
      set({ phase: "dirty" });
    };
    const field: Field = {
      snapshot: () => snapshot,
      change: reset,
      reset,
      sync(input) {
        if (input !== draft) reset(input);
      },
      commit(retry = false) {
        if (
          !alive ||
          snapshot.phase === "pending" ||
          (snapshot.phase !== "dirty" && !(retry && snapshot.phase === "error"))
        )
          return;
        // この確定処理がどの編集に対応するかを記憶します。
        // 待機中に再編集されるとgenerationが変わり、古い結果は破棄されます。
        const ownGeneration = generation;
        const current = getConfig();
        set({ phase: "pending" });
        handle = track(key, (context) => current.normalize(draft, context), {
          timeoutMs: current.timeoutMs,
          onCommit(result) {
            if (!alive || generation !== ownGeneration) return;
            if (typeof result !== "string")
              throw new TypeError("normalizeはstringを返してください");
            synchronous(getConfig().onCommit(result), "onCommit");
            draft = result;
          },
        });
        void handle.result.then((result) => {
          if (!alive || generation !== ownGeneration) return;
          if (result.status === "fulfilled") set(cleanField);
          else if (
            result.status === "cancelled" ||
            result.status === "superseded"
          )
            set({ phase: "dirty" });
          else set({ phase: "error", error: result.error });
        });
      },
      dispose() {
        if (!alive) return;
        alive = false;
        generation++;
        handle?.cancel();
        if (fields.get(key) === field) {
          fields.delete(key);
          failures.delete(key);
        }
        set({ phase: "disposed" });
      },
    };
    fields.set(key, field);
    changed();
    return field;
  }
  const flushFields = () => fields.forEach((field) => field.commit());
  const hasPending = () =>
    [...tasks.values()].some((task) => task.blocking) ||
    [...fields.values()].some((field) =>
      ["dirty", "pending"].includes(field.snapshot().phase),
    );
  /**
   * dirty入力を確定し、blockingタスクがなくなるまで購読して待ちます。
   * Promise.allを一度だけ呼ぶ方法と違い、待機途中の追加・削除にも追従します。
   * この関数だけではReactのstate反映待ちは行いません。画面ではuseAfterTasksを使用します。
   */
  async function wait(
    options: { signal?: AbortSignal; timeoutMs?: Timeout } = {},
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
        finish(new AsyncTaskError("cancelled", "待機を取り消しました"));
      let checking = false;
      const check = () => {
        if (finished || checking) return;
        checking = true;
        try {
          if (disposed) {
            abort();
            return;
          }
          flushFields();
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
              new AsyncTaskError(
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
    track,
    wait,
    flushFields,
    hasPending,
    assertSuccess,
    mountField,
    /**
     * 旧API: 開始済みPromiseを登録します。元の処理は強制停止できません。
     * @example register(handleBlur(value), "name");
     */
    register(task: Promise<unknown>, key: string | symbol = Symbol()) {
      track(key, () => task);
    },
    /** 全体エラーを解除し、managed入力の失敗は再確定します。通常は項目の再編集で回復します。 */
    clearErrors() {
      failures.clear();
      fields.forEach((field) => {
        if (field.snapshot().phase === "error") field.commit(true);
      });
      changed();
    },
    getFieldSnapshot: (key: string) =>
      fields.get(key)?.snapshot() ?? cleanField,
    resetField(key: string, value: string) {
      fields.get(key)?.reset(value);
    },
    cancelInputs() {
      for (const task of [...tasks.values()])
        if (task.blocking) task.cancel("cancelled");
    },
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => actionSnapshot,
    getBusy: () => actionSnapshot.busy,
    beginAction(): ActionOwner | null {
      if (owner || disposed) return null;
      owner = {
        id: requestId(),
        controller: new AbortController(),
        settled: false,
        uncertain: false,
        phase: "preparing",
      };
      publishAction();
      return owner;
    },
    setPhase(current: ActionOwner, phase: ActionPhase) {
      if (owner === current) {
        current.phase = phase;
        publishAction();
      }
    },
    release(current: ActionOwner) {
      if (owner === current && !current.uncertain) {
        owner = null;
        publishAction();
      }
    },
    markUncertain(current: ActionOwner) {
      if (owner !== current) return;
      current.uncertain = true;
      current.phase = "uncertain";
      current.controller.abort();
      publishAction();
    },
    /**
     * 結果不明の保存をサーバーへ照会して回復します。
     * 元のactionが終了し、かつsaved/not-savedが判明した場合のみtrueを返します。
     * lookupは実際の照会処理を指定してください。固定値を返してロックを消さないこと。
     * @example await reconcile(requestId, id => saveAdapter.lookup(id));
     */
    async reconcile(
      id: string,
      lookup: (requestId: string) => Promise<"saved" | "not-saved" | "unknown">,
    ) {
      const current = owner;
      if (!current || !current.uncertain || current.id !== id) return false;
      const outcome = await lookup(id);
      if (
        owner !== current ||
        !current.settled ||
        (outcome !== "saved" && outcome !== "not-saved")
      )
        return false;
      owner = null;
      publishAction();
      return true;
    },
    tryAcquire() {
      const current = store.beginAction();
      return current ? () => store.release(current) : null;
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
          for (const field of [...fields.values()]) field.dispose();
          for (const task of [...tasks.values()]) task.cancel("cancelled");
          owner?.controller.abort();
          changed();
          listeners.clear();
        });
      };
    },
  };
  return store;
}
export type TaskStore = ReturnType<typeof createTaskStore>;
const Context = createContext<TaskStore | null>(null);
/**
 * フォームごとに置く管理範囲です。この範囲内の入力を待ち、保存操作を1つに制限します。
 * configはScope作成時に固定します。変更にはProviderをkeyで再作成してください。
 * @example
 * // 3種類すべてnullにすると、入力・確定待機・保存を無期限で待てます。
 * <AsyncTasksProvider taskTimeoutMs={null} waitTimeoutMs={null} actionTimeoutMs={null}>
 *   <EditForm />
 * </AsyncTasksProvider>
 */
export function AsyncTasksProvider({
  children,
  ...config
}: TasksConfig & { children: ReactNode }) {
  const [store] = useState(() => createTaskStore(config));
  useCommitEffect(() => store.attach(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
/**
 * Provider内のタスク操作を取得します。Promiseの全自動検出は行いません。
 * @example
 * const tasks = useAsyncTasks();
 * tasks.track("suggestions", ({ signal }) => fetch("/api/suggestions", { signal }), {
 *   blocking: false, // 保存対象のデータとは無関係な背景処理
 * });
 */
export function useAsyncTasks() {
  const store = useContext(Context);
  if (!store) throw new Error("AsyncTasksProviderが必要です");
  return store;
}
/**
 * 最新のcommit済み値を読む安定したgetterを返します。
 * render中にrefを書き換えないため、途中で破棄されたレンダーの値を公開しません。
 * setState直後の値を即座に取得する関数ではありません。
 * @example
 * const getValues = useLatestCommitted(values);
 * const { run } = useAfterTasks(async () => {
 *   await checkPermission();
 *   await save(getValues()); // checkPermission待機中の編集も含めて読む場合
 * }, { onError: console.error });
 */
export function useLatestCommitted<T>(value: T): () => T {
  const ref = useRef(value);
  useCommitEffect(() => {
    ref.current = value;
  });
  return useCallback(() => ref.current, []);
}
/**
 * blur失敗を保存ボタンが押される前から表示するための購読Hookです。
 * @example
 * const field = useTaskField("name");
 * return field.phase === "error" ? <span role="alert">入力を確認してください</span> : null;
 */
export function useTaskField(key: string): FieldSnapshot {
  const store = useAsyncTasks();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getFieldSnapshot(key),
    () => cleanField,
  );
}
/** onErrorは保存要求の失敗通知。beforeWaitはblurなどの同期準備に利用します。 */
export type AfterTasksOptions = {
  onError: (error: unknown) => void;
  beforeWait?: () => void;
  waitTimeoutMs?: Timeout;
  actionTimeoutMs?: Timeout;
};
/**
 * タスク完了と再レンダーを経由してactionを実行します。
 * runはイベント用のvoid関数で、await run()では保存完了を待てません。
 * busyは待機/保存中、blockedは保存結果が不明で再送を止めている状態です。
 * action内のawait後に同じclosureのstateが自動更新されるわけではありません。
 * @example
 * const { run, busy, blocked } = useAfterTasks(async ({ signal, requestId }) => {
 *   await save(values, { signal, requestId });
 *   navigate("/complete"); // 保存成功後の処理もこの中へ
 * }, { onError: error => setError(String(error)) });
 * return <button onClick={run} disabled={busy || blocked}>保存</button>;
 */
export function useAfterTasks(
  action: (context: ActionContext) => void | Promise<void>,
  options: AfterTasksOptions,
) {
  const store = useAsyncTasks();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => idleAction,
  );
  const getOptions = useLatestCommitted(options);
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
  const fail = (current: Request, error: unknown) => {
    if (!current.active || current.notified) return;
    current.notified = true;
    try {
      getOptions().onError(error);
    } catch (cause) {
      console.error(cause);
    }
  };
  useCommitEffect(
    () => () => {
      const current = pending.current;
      if (!current) return;
      current.active = false;
      clearTimeout(current.timer);
      pending.current = null;
      if (!current.started) {
        current.owner.controller.abort();
        store.release(current.owner);
      } else {
        store.markUncertain(current.owner);
      }
    },
    [store],
  );
  // ここではactionを呼びません。完了を次のレンダーへ渡すことが重要です。
  function prepare(current: Request) {
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
  }
  function run() {
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
          new AsyncTaskError(
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
      synchronous(getOptions().beforeWait?.(), "beforeWait");
      store.setPhase(owner, "waiting");
      prepare(current);
    } catch (error) {
      clearTimeout(current.timer);
      fail(current, error);
      current.active = false;
      pending.current = null;
      store.release(owner);
    }
  }
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
        store.markUncertain(current.owner);
        fail(
          current,
          new AsyncTaskError(
            "uncertain",
            "保存がタイムアウトしました。結果を照会してください",
            { requestId: current.owner.id },
          ),
        );
      }, actionTimeout);
    void (async () => {
      try {
        store.assertSuccess();
        await action({
          signal: current.owner.controller.signal,
          requestId: current.owner.id,
        });
      } catch (error) {
        if (
          error instanceof UncertainActionError ||
          (error instanceof AsyncTaskError && error.kind === "uncertain")
        )
          store.markUncertain(current.owner);
        fail(current, error);
      } finally {
        current.owner.settled = true;
        clearTimeout(current.timer);
        if (pending.current === current) pending.current = null;
        current.active = false;
        store.release(current.owner);
      }
    })();
  }, [revision, action, actionTimeout, store]);
  return { run, ...snapshot, reconcile: store.reconcile };
}

/** 通常のinputや既存のUIライブラリーを使うための入力設定です。 */
export type AsyncFieldOptions = FieldConfig & {
  taskKey: string;
  value: string;
  /** 同じvalueのままでも、この値を変更すると再確定します。 */
  resetKey?: unknown;
};

/**
 * TrackedInputを使わずに、入力の世代・確定・破棄を管理します。
 * changeはstateを変更しないため、画面のsetterも呼んでください。
 * commitはblurで呼びます。runからもdirty項目を自動確定するため、blur漏れに対応します。
 * @example
 * const nameField = useAsyncField({
 *   taskKey: "name", value: name,
 *   normalize: (input, { signal }) => normalizeName(input, { signal }),
 *   onCommit: setName,
 *   timeoutMs: null, // この入力の処理を無期限で待つ
 * });
 * return <input value={name} onChange={event => {
 *   const value = event.currentTarget.value;
 *   nameField.change(value); // 古い結果を、この時点で無効化する
 *   setName(value);
 * }} onBlur={nameField.commit} />;
 */
export function useAsyncField(options: AsyncFieldOptions) {
  return useManagedField(options);
}

// TrackedInputの互換形式はnullを渡し、入力の所有者を登録しません。
// 公開Hookと入力部品が同じ管理処理を使うため、競合対策が二重実装になりません。
function useManagedField(options: AsyncFieldOptions | null) {
  const store = useAsyncTasks();
  const enabled = options !== null;
  const taskKey = options?.taskKey;
  const value = options?.value;
  const resetKey = options?.resetKey;
  if (options) duration(options.timeoutMs, store.defaults.taskTimeoutMs);
  const field = useRef<Field | null>(null);
  const getOptions = useLatestCommitted(options);
  const getConfig = useCallback((): FieldConfig => {
    const current = getOptions();
    if (!current) throw new Error("managed入力の設定が変更されました");
    return current;
  }, [getOptions]);
  useCommitEffect(() => {
    if (!enabled || taskKey === undefined) return;
    const current = getOptions();
    if (!current || typeof current.value !== "string")
      throw new TypeError("managed入力はstringのvalueが必要です");
    const mounted = store.mountField(taskKey, current.value, getConfig);
    field.current = mounted;
    return () => {
      mounted.dispose();
      if (field.current === mounted) field.current = null;
    };
  }, [enabled, store, taskKey, getOptions, getConfig]);
  useCommitEffect(() => {
    if (enabled && value !== undefined) field.current?.sync(value);
  }, [enabled, value]);
  const previousReset = useRef(resetKey);
  useCommitEffect(() => {
    if (!Object.is(previousReset.current, resetKey)) {
      previousReset.current = resetKey;
      if (value !== undefined) field.current?.reset(value);
    }
  }, [resetKey, value]);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    () =>
      taskKey === undefined ? cleanField : store.getFieldSnapshot(taskKey),
    () => cleanField,
  );
  const change = useCallback(
    (input: string) => field.current?.change(input),
    [],
  );
  const commit = useCallback(() => field.current?.commit(true), []);
  const reset = useCallback((input: string) => field.current?.reset(input), []);
  return { change, commit, reset, ...snapshot };
}

type InputBase = Omit<ComponentPropsWithoutRef<"input">, "onBlur"> & {
  taskKey: string;
};
/** 旧onBlur形式とmanaged形式は同時指定できません。managed形式は文字列の入力専用です。 */
export type TrackedInputProps = InputBase &
  (
    | {
        normalize?: never;
        onCommit?: never;
        timeoutMs?: never;
        resetKey?: never;
        onBlur?: (event: FocusEvent<HTMLInputElement>) => void | Promise<void>;
      }
    | {
        value: string;
        type?: "text" | "search" | "email" | "tel" | "url" | "password";
        normalize: FieldConfig["normalize"];
        onCommit: FieldConfig["onCommit"];
        timeoutMs?: Timeout;
        resetKey?: unknown;
        onBlur?: never;
      }
  );
/**
 * normalize（通信/計算）とonCommit（state反映）を分けた入力部品です。
 * 最新の世代の結果だけonCommitへ渡すので、画面側で世代番号を管理する必要がありません。
 * 初期valueは確定済みとして扱います。resetKey変更で同じ値も再確定対象にできます。
 * @example
 * <TrackedInput taskKey="name" value={name}
 *   onChange={event => setName(event.currentTarget.value)}
 *   normalize={(input, { signal }) => normalizeName(input, { signal })}
 *   onCommit={setName} />
 *
 * @example
 * // 互換形式。完了は待てますが、内部の古いsetStateは共通側から取り消せません。
 * <TrackedInput taskKey="name" onBlur={async event => {
 *   const input = event.currentTarget.value; // awaitより前に取得
 *   await legacyBlur(input);
 * }} />
 */
export const TrackedInput = forwardRef<HTMLInputElement, TrackedInputProps>(
  function TrackedInput(props, ref) {
    const store = useAsyncTasks();
    const {
      taskKey,
      normalize,
      onCommit,
      timeoutMs,
      resetKey,
      onBlur,
      onChange,
      ...input
    } = props;
    const managed = normalize !== undefined;
    const field = useManagedField(
      managed
        ? {
            taskKey,
            value: input.value as string,
            normalize,
            onCommit: onCommit!,
            timeoutMs,
            resetKey,
          }
        : null,
    );
    return (
      <input
        {...input}
        ref={ref}
        onChange={(event) => {
          field.change(event.currentTarget.value);
          onChange?.(event);
        }}
        onBlur={(event) => {
          if (managed) {
            field.commit();
            return;
          }
          try {
            store.register(Promise.resolve(onBlur?.(event)), taskKey);
          } catch (error) {
            store.register(Promise.reject(error), taskKey);
          }
        }}
      />
    );
  },
);

/**
 * formにspreadするイベント群。変換確定のEnterで保存しないよう押下サイクルを管理します。
 * preventDefaultはイベント配送中に実行し、イベントオブジェクトを後で使い回しません。
 * 実OSのIMEはブラウザー自動化の合成イベントと異なるため、利用環境でも確認してください。
 * @example
 * const { run } = useAfterTasks(save, { onError: console.error });
 * const submitEvents = useAsyncSubmit(run);
 * return <form {...submitEvents}><input /><button type="submit">保存</button></form>;
 */
export function useAsyncSubmit(run: () => void) {
  const ime = useRef({
    composing: false,
    ended: false,
    suppressEnter: false,
    explicit: false,
  });
  return {
    onCompositionStart: () => {
      ime.current.composing = true;
      ime.current.ended = false;
    },
    onCompositionEnd: () => {
      ime.current.composing = false;
      ime.current.ended = true;
    },
    onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => {
      const state = ime.current;
      if (event.key === "Enter") {
        const composing =
          state.composing ||
          state.ended ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229;
        state.ended = false;
        state.explicit = false;
        if (composing) {
          state.suppressEnter = true;
          event.preventDefault();
        }
      } else if (event.keyCode === 229) {
        state.suppressEnter = true;
      } else {
        state.ended = false;
      }
    },
    onKeyUp: (event: KeyboardEvent<HTMLFormElement>) => {
      if (event.key === "Enter" || event.keyCode === 229) {
        ime.current.suppressEnter = false;
        ime.current.ended = false;
      }
    },
    onPointerDown: () => {
      ime.current.explicit = true;
      ime.current.suppressEnter = false;
      ime.current.ended = false;
    },
    onSubmit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const state = ime.current;
      const allow =
        state.explicit || (!state.composing && !state.suppressEnter);
      state.explicit = false;
      if (allow) run();
    },
  };
}
