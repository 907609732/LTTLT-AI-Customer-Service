export type Store={id:string;name:string;platform:string;status:'online'|'offline'};
export type AppSettings={mode:string;lastSentence:boolean;welcome:string;autoTransfer:boolean};
export type DesignPathItem={id:string;name:string;type:string};
export type DesignNode={id:string;name:string;type:string;width:number;height:number;x:number;y:number;absoluteBounds:{x:number;y:number;width:number;height:number}|null;path:DesignPathItem[];preview:string;document:Record<string,unknown>;components:Record<string,unknown>;styles:Record<string,unknown>;schemaVersion:string|number|null;warning:string};
export type Snapshot={schema:string;version:number;fileName:string;pageId:string;pageName:string;exportedAt:string;source:string;nodes:DesignNode[]};
declare global{interface Window{lingtu?:{info:()=>Promise<{version:string;platform:string;mode:string}>;importDesign:()=>Promise<{canceled:boolean;snapshot?:Snapshot}>;latestDesignSnapshot:()=>Promise<{snapshot:Snapshot|null}>;windowAction:(action:'minimize'|'maximize'|'close')=>Promise<void>}}}
