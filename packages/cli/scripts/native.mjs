import { spawn } from "node:child_process";
import { constants } from "node:os";

const CAPTURE_OUTPUT_DRAIN_GRACE_MS = 2000;

export async function spawnNative(args, options = {}) {
  const executable = options.nativeExecutable;
  if (!executable) {
    throw new Error("Palamedes native CLI executable is not configured.");
  }
  if (options.signal?.aborted) {
    return abortExitCode(options.signal.reason);
  }

  return new Promise((resolve, reject) => {
    const captureOutput = options.captureOutput === true;
    const isolatedSignalGroup = process.platform !== "win32";
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
      // On Unix the native CLI becomes its own process-group leader. Terminal
      // signals reach this launcher once and are forwarded to that group once,
      // instead of reaching the child directly and then being duplicated.
      detached: isolatedSignalGroup,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let childExited = false;
    let exitCode;
    let exitSignal;
    let outputDrainTimer;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    const onStdoutData = (chunk) => {
      stdout += chunk;
    };
    const onStderrData = (chunk) => {
      stderr += chunk;
    };
    child.stdout?.on("data", onStdoutData);
    child.stderr?.on("data", onStderrData);
    const forwardSignal = (signal) => {
      if (settled) return false;
      try {
        if (isolatedSignalGroup && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      return true;
    };
    const onAbort = () => forwardSignal(options.signal?.reason?.signal ?? "SIGTERM");
    // Forward direct and terminal signals to the isolated native process group
    // so killing the launcher never orphans native subprocesses. On Windows,
    // the launcher and native child share a console, so CTRL_C_EVENT already
    // reaches both. Keep the listener alive while the native child shuts down,
    // but do not turn that cooperative interrupt into child.kill("SIGINT"),
    // which libuv implements as a hard TerminateProcess.
    const forwardInterrupt = () => forwardTerminalInterrupt(process.platform, forwardSignal);
    const forwardTerminate = () => forwardSignal("SIGTERM");
    // A terminal hangup reaches the npm launcher but not its detached native
    // process group. Keep the launcher alive until the native process has
    // handled that hangup and exited.
    const forwardHangup = () => forwardSignal("SIGHUP");
    // `process.exit()` and uncaught failures still run this synchronous hook.
    // SIGKILL cannot be intercepted; a native parent-death mechanism would be
    // platform-specific and belongs outside this JavaScript wrapper.
    const onParentExit = () => forwardSignal("SIGTERM");
    const cleanupOutput = () => {
      child.stdout?.off("data", onStdoutData);
      child.stderr?.off("data", onStderrData);
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const cleanup = () => {
      if (outputDrainTimer) {
        clearTimeout(outputDrainTimer);
        outputDrainTimer = undefined;
      }
      cleanupOutput();
      options.signal?.removeEventListener("abort", onAbort);
      process.off("SIGINT", forwardInterrupt);
      process.off("SIGTERM", forwardTerminate);
      if (isolatedSignalGroup) process.off("SIGHUP", forwardHangup);
      process.off("exit", onParentExit);
      child.off("error", onError);
      child.off("exit", onExit);
      if (captureOutput) child.off("close", onClose);
    };
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const resolveCapturedOutput = () => {
      const code = exitSignal ? signalExitCode(exitSignal) : (exitCode ?? 1);
      settle(() => resolve({ exitCode: code, stdout, stderr }));
    };
    const onError = (error) => settle(() => reject(error));
    const onExit = (code, signal) => {
      childExited = true;
      exitCode = code;
      exitSignal = signal;
      if (!captureOutput) {
        settle(() => resolve(signal ? signalExitCode(signal) : (code ?? 1)));
        return;
      }

      // `exit` can precede the final data events from piped stdio. Keep
      // draining until `close`, but do not wait forever when a grandchild
      // inherits the pipes and outlives the native child.
      outputDrainTimer = setTimeout(resolveCapturedOutput, CAPTURE_OUTPUT_DRAIN_GRACE_MS);
    };
    const onClose = () => {
      if (captureOutput && childExited) resolveCapturedOutput();
    };

    child.once("error", onError);
    child.once("exit", onExit);
    if (captureOutput) child.once("close", onClose);

    options.signal?.addEventListener("abort", onAbort, { once: true });
    process.on("SIGINT", forwardInterrupt);
    process.on("SIGTERM", forwardTerminate);
    if (isolatedSignalGroup) process.on("SIGHUP", forwardHangup);
    process.once("exit", onParentExit);
    if (options.signal?.aborted) onAbort();
  });
}

export function forwardTerminalInterrupt(platform, forwardSignal) {
  if (platform === "win32") return false;
  return forwardSignal("SIGINT");
}

function signalExitCode(signal) {
  const signalNumber = constants.signals[signal];
  return Number.isInteger(signalNumber) ? 128 + signalNumber : 1;
}

function abortExitCode(reason) {
  if (Number.isInteger(reason?.exitCode)) return reason.exitCode;
  return reason?.signal === "SIGTERM" ? 143 : 130;
}
