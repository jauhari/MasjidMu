import { toast as sonnerToast } from 'vue-sonner';

export const toast = {
  success: (msg: string, desc?: string) => sonnerToast.success(msg, { description: desc }),
  error: (msg: string, desc?: string) => sonnerToast.error(msg, { description: desc }),
  info: (msg: string, desc?: string) => sonnerToast.info(msg, { description: desc }),
  warning: (msg: string, desc?: string) => sonnerToast.warning(msg, { description: desc }),
};
