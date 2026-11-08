/** Figma constraints resize geometry; font sizes, strokes and icons stay source-sized. */
function axis(position,size,oldParent,newParent,constraint){
 const delta=newParent-oldParent;
 switch(constraint){
  case 'MAX':case 'RIGHT':case 'BOTTOM':return [position+delta,size];
  case 'CENTER':return [position+delta/2,size];
  case 'STRETCH':case 'LEFT_RIGHT':case 'TOP_BOTTOM':return [position,Math.max(.01,size+delta)];
  case 'SCALE':return oldParent>0?[position*newParent/oldParent,size*newParent/oldParent]:[position,size];
  default:return [position,size];
 }
}
export function constrainProperties(props,oldParent,newParent){
 if(!oldParent||!newParent)return props;
 const size=props.size||{x:0,y:0},m=props.transform||{m00:1,m01:0,m02:0,m10:0,m11:1,m12:0};
 const [x,width]=axis(m.m02,size.x,oldParent.x,newParent.x,props.constraints?.horizontal);
 const [y,height]=axis(m.m12,size.y,oldParent.y,newParent.y,props.constraints?.vertical);
 return {...props,size:{x:width,y:height},transform:{...m,m02:x,m12:y}};
}
