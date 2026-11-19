declare namespace chrome {
  namespace runtime {
    const id: string | undefined;
    const lastError: { message?: string } | undefined;
    function sendMessage(...args: any[]): any;
    const onMessage: {
      addListener: (cb: (...args: any[]) => any) => void;
      removeListener: (cb: (...args: any[]) => any) => void;
    };
  }
  namespace extension {
    function isAllowedFileSchemeAccess(cb: (allowed: boolean) => void): void;
  }
  namespace tabs {
    function query(...args: any[]): any;
    function sendMessage(...args: any[]): any;
    function create(...args: any[]): any;
  }
  namespace storage {
    const local: {
      get: (...args: any[]) => any;
      set: (...args: any[]) => any;
      remove: (...args: any[]) => any;
    };
  }
}

declare module "@rhwp/hwpctrl/studio-plugin" {
  export const hwpctrlStudioPlugin: any;
  export function installHwpCtrlStudioPlugin(...args: any[]): any;
  const _default: any;
  export default _default;
}
