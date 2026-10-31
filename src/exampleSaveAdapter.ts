import {
  AsyncTaskError,
  UncertainActionError,
  type ActionContext,
} from "./AsyncTasks";

/** サーバーとの契約例。サーバー側に冪等性・結果照会の実装が別途必要です。 */
export function createHttpSaveAdapter<T>(url: string) {
  return {
    async save(value: T, { signal, requestId }: ActionContext): Promise<void> {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": requestId,
          },
          body: JSON.stringify(value),
        });
      } catch (cause) {
        throw new UncertainActionError(cause);
      }
      if (response.ok) return;
      // この例は { committed: false } を「未保存確定」とするサーバー契約。
      // HTTPのエラーコードだけから、保存していないと推定しない。
      const body = (await response.json().catch(() => null)) as {
        committed?: boolean;
      } | null;
      if (body?.committed === false)
        throw new AsyncTaskError("action", "サーバーが保存を拒否しました");
      throw new UncertainActionError(response.status);
    },
    async lookup(
      requestId: string,
    ): Promise<"saved" | "not-saved" | "unknown"> {
      const response = await fetch(
        `${url}/requests/${encodeURIComponent(requestId)}`,
      );
      if (!response.ok) return "unknown";
      const body = (await response.json()) as { status?: unknown };
      return body.status === "saved" || body.status === "not-saved"
        ? body.status
        : "unknown";
    },
  };
}

/** テスト/デモ専用。同じrequestIdのpayload不一致を拒否する、サーバー側契約のfake。 */
export function createMemorySaveAdapter<T>() {
  const records = new Map<string, string>();
  return {
    async save(value: T, { requestId }: ActionContext) {
      const body = JSON.stringify(value);
      if (records.has(requestId) && records.get(requestId) !== body)
        throw new AsyncTaskError("action", "冪等性キーのpayloadが一致しません");
      records.set(requestId, body);
    },
    async lookup(id: string): Promise<"saved" | "not-saved"> {
      return records.has(id) ? "saved" : "not-saved";
    },
    getCount: () => records.size,
  };
}
