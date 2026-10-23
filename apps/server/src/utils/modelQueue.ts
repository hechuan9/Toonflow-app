// ACT: 单进程、请求生命周期队列；重启不恢复未完成请求，与现有媒体任务生命周期一致。
type Task = { id: string; model: string; label: string; state: string; stage: string; progress: number | null; createdAt: number; startedAt?: number; finishedAt?: number; error?: string };
type Model = { key: string; label: string; kind: "text" | "media" };
type Lease = { task: Task; update: (stage: string, progress?: number | null) => void; finish: (error?: unknown) => void };
type Pending = { model: Model; task: Task; signal?: AbortSignal; resolve: (lease: Lease) => void; reject: (error: unknown) => void; abort: () => void };
const comfyUrl = process.env.TOONFLOW_COMFY_URL?.replace(/\/$/, "");
const llamaUrl = process.env.TOONFLOW_LLAMA_URL?.replace(/\/$/, "");
const enabled = !!comfyUrl && !!llamaUrl;
const mediaProviders = (process.env.TOONFLOW_LOCAL_MEDIA_PROVIDERS ?? "").split(",");
const configuredTtl = Number(process.env.TOONFLOW_MODEL_TTL_SECONDS ?? 120);
const ttlSeconds = Number.isFinite(configuredTtl) && configuredTtl >= 1 ? configuredTtl : 120;
const pending: Pending[] = [];
const tasks: Task[] = [];
const logs: { time: number; message: string }[] = [];
let resident: Model | null = null;
let phase = "等待任务";
let idleExpiresAt: number | null = null;
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function log(message: string) {
  logs.push({ time: Date.now(), message });
  if (logs.length > 200) logs.shift();
}
function stage(task: Task, message: string, progress: number | null = null) {
  if (task.stage !== message) log(`${task.label}：${message}`);
  task.stage = message;
  task.progress = progress;
  phase = message;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 500));
async function json(base: string, path: string, body?: object): Promise<any> {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(30000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`本地模型服务 ${path}：HTTP ${response.status}`);
  return response.json();
}
async function waitComfyIdle() {
  while (true) {
    const queue = await json(comfyUrl!, "/queue");
    if (!queue.queue_running.length && !queue.queue_pending.length) return;
    phase = "等待已有图片／视频任务结束";
    await pause();
  }
}
async function releaseComfy() {
  await waitComfyIdle();
  await json(comfyUrl!, "/toonflow/release", {});
  const deadline = Date.now() + 120000;
  while (true) {
    const resources = await json(comfyUrl!, "/toonflow/resources");
    if (!resources.releasePending && resources.loadedModels === 0) return;
    if (Date.now() >= deadline) throw new Error("图片／视频模型释放超时，尚未确认资源释放");
    await pause();
  }
}
async function releaseText() {
  for (const model of (await json(llamaUrl!, "/models")).data) {
    if (model.status.value === "unloaded") continue;
    while (true) {
      const current = (await json(llamaUrl!, "/models")).data.find((item: any) => item.id === model.id);
      if (!current || current.status.value === "unloaded") break;
      if (current.status.value === "loading" || current.status.value === "stopping") { phase = "等待文字模型切换结束"; await pause(); continue; }
      if (current.status.value === "loaded") {
        const slots = await json(llamaUrl!, "/slots?model=" + encodeURIComponent(model.id));
        if (slots.some((slot: any) => slot.is_processing)) { phase = "等待已有文字任务结束"; await pause(); continue; }
      }
      await json(llamaUrl!, "/models/unload", { model: model.id });
      // 卸载应答早于子进程退出；此后只轮询目录，查询 slots 会重新唤醒模型。
      const deadline = Date.now() + 120000;
      while (true) {
        const state = (await json(llamaUrl!, "/models")).data.find((item: any) => item.id === model.id)?.status.value;
        if (!state || state === "unloaded") break;
        if (Date.now() >= deadline) throw new Error("文字模型卸载超时");
        await pause();
      }
      break;
    }
  }
}
async function releaseResident() {
  phase = "释放模型与缓存";
  log(resident ? `释放 ${resident.label}` : "同步并释放已有模型资源");
  // 首次启动也清理另一服务已有的驻留模型；不把进程内状态当作 GPU 真源。
  await releaseComfy();
  await releaseText();
  resident = null;
  idleExpiresAt = null;
  log("模型资源已释放");
}
function schedule(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => { void pump(); }, delay);
  timer.unref();
}
async function pump() {
  if (busy) return;
  if (!pending.length) {
    if (!resident) { phase = "等待任务"; return; }
    idleExpiresAt ??= Date.now() + ttlSeconds * 1000;
    if (Date.now() < idleExpiresAt) { phase = "模型空闲驻留"; schedule(idleExpiresAt - Date.now()); return; }
    busy = true;
    try { await releaseResident(); phase = "等待任务"; }
    catch (error) { phase = "释放失败"; log(String(error)); idleExpiresAt = Date.now() + 10000; }
    finally { busy = false; schedule(pending.length ? 0 : 10000); }
    return;
  }
  busy = true;
  idleExpiresAt = null;
  const index = Math.max(0, pending.findIndex(item => item.model.key === resident?.key));
  const item = pending.splice(index, 1)[0]!;
  item.signal?.removeEventListener("abort", item.abort);
  try {
    item.signal?.throwIfAborted();
    item.task.state = "running";
    item.task.startedAt = Date.now();
    if (resident?.key !== item.model.key) {
      stage(item.task, "等待资源与模型切换");
      await releaseResident();
      item.signal?.throwIfAborted();
      resident = item.model;
      stage(item.task, "加载模型／准备输入");
    } else stage(item.task, "复用当前模型");
    let finished = false;
    item.resolve({ task: item.task, update: (message, progress = null) => stage(item.task, message, progress), finish: error => {
      if (finished) return;
      finished = true;
      item.task.state = item.signal?.aborted ? "cancelled" : error ? "failed" : "completed";
      item.task.error = error ? (error instanceof Error ? error.message : String(error)).slice(0, 500) : undefined;
      stage(item.task, item.task.state === "completed" ? "已完成" : item.task.state === "cancelled" ? "已取消" : "失败", item.task.state === "completed" ? 100 : null);
      item.task.finishedAt = Date.now();
      busy = false;
      // ACT: 给现有逐张提交的批次一次提交下一张的机会，再按同模型优先调度。
      schedule(300);
    } });
  } catch (error) {
    item.task.state = item.signal?.aborted ? "cancelled" : "failed";
    item.task.error = error instanceof Error ? error.message : String(error);
    item.task.finishedAt = Date.now();
    item.task.stage = "未能取得模型资源";
    log(`${item.task.label}：${item.task.error}`);
    item.reject(error);
    busy = false;
    schedule();
  }
}
function acquire(model: Model, signal?: AbortSignal): Promise<Lease> {
  signal?.throwIfAborted();
  if (pending.length >= 1000) throw new Error("本地模型队列已满，请稍后重试");
  const id = crypto.randomUUID();
  const task: Task = { id, model: model.label, label: `${model.label} · ${id.slice(0, 8)}`, state: "queued", stage: "等待模型队列", progress: null, createdAt: Date.now() };
  tasks.push(task);
  while (tasks.length > 200 && tasks[0]?.finishedAt) tasks.shift();
  log(`${task.label}：已排队`);
  return new Promise((resolve, reject) => {
    const item: Pending = { model, task, signal, resolve, reject, abort: () => {
      const index = pending.indexOf(item);
      if (index < 0) return;
      pending.splice(index, 1);
      task.state = "cancelled"; task.stage = "排队已取消"; task.finishedAt = Date.now();
      reject(signal?.reason ?? new Error("已取消"));
    } };
    pending.push(item);
    signal?.addEventListener("abort", item.abort, { once: true });
    schedule();
  });
}
export function status() {
  return { enabled, residentModel: resident?.label ?? null, phase, idleExpiresAt, ttlSeconds, tasks, logs };
}

export function queueTextFetch(baseUrl: string, modelId: string, label: string, fetcher: typeof fetch): typeof fetch {
  if (!enabled || new URL(baseUrl).origin !== new URL(llamaUrl!).origin) return fetcher;
  return Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
    const lease = await acquire({ key: `text:${modelId}`, label, kind: "text" }, signal);
    try {
      lease.update("加载文字模型／处理上下文");
      const response = await fetcher(input, init);
      const reader = response.body?.getReader();
      if (!reader) { lease.finish(response.ok ? undefined : new Error(`文字模型 HTTP ${response.status}`)); return response; }
      lease.update("生成文字（总长度未知）");
      let bytes = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) { lease.finish(response.ok ? undefined : new Error(`文字模型 HTTP ${response.status}`)); controller.close(); }
            else { bytes += result.value.byteLength; lease.task.stage = `生成文字 · 已接收 ${Math.ceil(bytes / 1024)} KB（总长度未知）`; controller.enqueue(result.value); }
          } catch (error) { lease.finish(error); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { lease.finish(reason ?? new Error("文字流已关闭")); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { lease.finish(error); throw error; }
  }, { preconnect: fetcher.preconnect }) as typeof fetch;
}

export async function runMedia<T>(providerId: string, modelId: string, label: string, signal: AbortSignal | undefined,
  fetcher: typeof fetch, run: (request: typeof fetch) => Promise<T>): Promise<T> {
  if (!enabled || !mediaProviders.includes(providerId)) return run(fetcher);
  const lease = await acquire({ key: `media:${providerId}:${modelId}`, label, kind: "media" }, signal);
  let promptId: string | undefined;
  let socket: WebSocket | undefined;
  let failure: unknown;
  let nodes: Record<string, { class_type?: string }> = {};
  const clientId = crypto.randomUUID();
  const trackedFetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== new URL(comfyUrl!).origin) return fetcher(input, init);
    if (url.pathname === "/prompt" && typeof init?.body === "string") {
      const body = JSON.parse(init.body);
      nodes = body.prompt;
      const wsUrl = new URL(comfyUrl! + "/ws"); wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"; wsUrl.searchParams.set("clientId", clientId);
      socket = new WebSocket(wsUrl);
      socket.addEventListener("message", event => {
        if (typeof event.data !== "string") return;
        const eventData = JSON.parse(event.data);
        const data = eventData.data;
        if (data?.prompt_id !== promptId) return;
        if (eventData.type === "executing" && data.node) {
          const name = nodes[data.node]?.class_type ?? data.node;
          lease.update(/Loader/.test(name) ? `加载模型 · ${name}` : /Decode|Save|CreateVideo/.test(name) ? `解码／保存 · ${name}` : `执行节点 · ${name}`);
        } else if (eventData.type === "progress" && data.max > 0) {
          lease.task.stage = `采样步骤 ${data.value} / ${data.max}`;
          lease.task.progress = Math.round(data.value / data.max * 100);
          phase = "模型执行中";
        }
      });
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 2000);
        socket!.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
        socket!.addEventListener("error", () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
      promptId = crypto.randomUUID();
      const response = await fetcher(input, { ...init, body: JSON.stringify({ ...body, client_id: clientId, prompt_id: promptId }) });
      const submitted = await response.clone().json() as { prompt_id?: string };
      promptId = submitted.prompt_id ?? promptId;
      if (promptId) lease.update("工作流已提交，等待模型执行");
      return response;
    }
    if (url.pathname === "/view") lease.update("读取生成结果");
    return fetcher(input, init);
  }, { preconnect: fetcher.preconnect }) as typeof fetch;
  try { return await run(trackedFetch); }
  catch (error) { failure = error; throw error; }
  finally {
    // 取消 HTTP 请求不等于 GPU 已停止；只删除自己的待执行项，等待自己的在途工作结束。
    if (promptId) {
      let settled = false;
      while (!settled) {
        try {
          const queue = await json(comfyUrl!, "/queue");
          const running = queue.queue_running.some((item: any[]) => item[1] === promptId);
          const queued = queue.queue_pending.some((item: any[]) => item[1] === promptId);
          if ((signal?.aborted || failure) && queued) {
            const response = await fetch(comfyUrl! + "/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [promptId] }), signal: AbortSignal.timeout(30000) });
            if (!response.ok) throw new Error("取消待执行任务失败");
          }
          settled = !running && !queued;
          if (!settled) { lease.update("等待已提交计算结束后释放资源"); await pause(); }
        } catch (error) { lease.update("模型服务连接中断，等待确认计算结束"); await new Promise(resolve => setTimeout(resolve, 3000)); }
      }
    }
    socket?.close();
    lease.finish(failure);
  }
}
