/** Renderer command results; Electron uses the guarded local backend, browser design preview uses the demo adapter. */
export type FrontendCommand={action:string;screenId:string;storeId:string;sourceNodeId:string;values:Record<string,unknown>;requestId:string};
export type FrontendResult={status:'ok'|'demo'|'not-connected';message?:string;data?:Record<string,unknown>;version?:string};
export interface FrontendServices{execute(command:FrontendCommand):Promise<FrontendResult>}
