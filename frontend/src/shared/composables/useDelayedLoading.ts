import { ref, reactive } from 'vue';

/** Show loading UI only if the operation takes longer than `delayMs` (avoids flash on cache hits). */
export function useDelayedLoading(delayMs = 120) {
  const visible = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function start(): void {
    stop();
    timer = setTimeout(() => {
      visible.value = true;
    }, delayMs);
  }

  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    visible.value = false;
  }

  // reactive() wraps the object so nested refs (like `visible`) are auto-unwrapped
  // when accessed in Vue templates — without this, `pageLoading.visible` evaluates
  // to the Ref object itself (truthy) instead of the boolean value.
  return reactive({ visible, start, stop });
}