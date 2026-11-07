export function initialInteractionState(screenId='UX01'){
 return {screenId,history:[],overlays:[],variants:{}};
}
/** Pure UI state. No platform login, customer send, order execution, or persistence side effects. */
export function applyInteraction(state,action,context){
 if(action.type==='CLOSE')return {...state,overlays:state.overlays.slice(0,-1)};
 if(action.type==='BACK'){
  const previous=state.history.at(-1);
  return previous?{...state,screenId:previous,history:state.history.slice(0,-1),overlays:[]}:state;
 }
 const destination=action.destinationId;
 if(!destination||!context.targets.has(destination))return state;
 const closedMap=context.receptionClosed||{};
 const shared=action.navigation==='CHANGE_TO'?closedMap[destination]:action.navigation==='NAVIGATE'?state.variants['@reception']:undefined;
 if(shared){const variants={...state.variants};for(const [id,value] of Object.entries(variants))if(closedMap[value])variants[id]=shared;variants['@reception']=shared;state={...state,variants};}
 if(action.navigation==='NAVIGATE'){
  const screenId=context.routes[destination];
  return screenId?{...state,screenId,history:[...state.history,state.screenId],overlays:[]}:state;
 }
 if(action.navigation==='OVERLAY')return {...state,overlays:[...state.overlays,destination]};
 if(action.navigation==='CHANGE_TO'){
  const set=context.sets[destination];
  const host=[...context.ancestors].reverse().find(n=>set&&context.sets[n.componentId]===set);
  return host?{...state,variants:{...state.variants,[host.id]:destination}}:state;
 }
 return state;
}
