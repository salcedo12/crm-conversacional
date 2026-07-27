import{b as e,e as s}from"./index-7JHraqy8.js";import{n as t}from"./firebase-CXoVJukC.js";/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c=[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]],_=e("plus",c);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]],f=e("save",i);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],k=e("trash-2",r),d=t(s,"listAdvisors"),y=t(s,"reassignLead"),p=t(s,"listCompanyUsers"),l=t(s,"createCompanyUser"),u=t(s,"updateCompanyUser");async function M(a){return(await d({companyId:a})).data.advisors}async function U(a,n,o){await y({companyId:a,leadId:n,advisorId:o})}async function w(a){return(await p({companyId:a})).data.users}async function F(a){return(await l(a)).data}async function L(a){await u(a)}const h=t(s,"listContactFields"),v=t(s,"saveContactFields");async function V(a){return(await h({companyId:a})).data.fields}async function b(a,n){return(await v({companyId:a,fields:n})).data.fields}export{_ as P,f as S,k as T,w as a,V as b,F as c,M as l,U as r,b as s,L as u};
