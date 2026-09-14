import{g as n,j as s}from"./index-DiJUUp9C.js";import{q as t}from"./firebase-BKxLj0n1.js";/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 6v6h4",key:"135r8i"}]],w=n("clock-3",c);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]],L=n("copy",i);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]],g=n("plus",r);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],M=n("trash-2",d);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=[["path",{d:"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5",key:"ftymec"}],["rect",{x:"2",y:"6",width:"14",height:"12",rx:"2",key:"158x01"}]],U=n("video",y),p=t(s,"listAdvisors"),l=t(s,"reassignLead"),h=t(s,"setLeadAssignmentLock"),u=t(s,"listCompanyUsers"),m=t(s,"createCompanyUser"),C=t(s,"updateCompanyUser");async function x(a){return(await p({companyId:a})).data.advisors}async function A(a,e,o){await l({companyId:a,leadId:e,advisorId:o})}async function F(a,e,o){await h({companyId:a,leadId:e,locked:o})}async function V(a){return(await u({companyId:a})).data.users}async function N(a){return(await m(a)).data}async function j(a){await C(a)}const k=t(s,"listContactFields"),_=t(s,"saveContactFields");async function $(a){return(await k({companyId:a})).data.fields}async function b(a,e){return(await _({companyId:a,fields:e})).data.fields}export{w as C,g as P,M as T,U as V,L as a,V as b,N as c,$ as d,F as e,x as l,A as r,b as s,j as u};
