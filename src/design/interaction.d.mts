export type InteractionAction={type:string;navigation?:string;destinationId?:string;transition?:unknown};
export type InteractionHost={id:string;componentId:string};
export type InteractionState={screenId:string;history:string[];overlays:string[];variants:Record<string,string>};
export function initialInteractionState(screenId?:string):InteractionState;
export function applyInteraction(state:InteractionState,action:InteractionAction,context:{routes:Record<string,string>;targets:Set<string>;sets:Record<string,string>;ancestors:InteractionHost[];receptionClosed?:Record<string,string>}):InteractionState;
