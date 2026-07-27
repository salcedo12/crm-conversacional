const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/LoginPage-1aepWquE.js","assets/react-BZRkfIaW.js","assets/Button-BWtCBzKI.js","assets/firebase-CXoVJukC.js","assets/DashboardPage-BVx0Fn4X.js","assets/thermometer-Btni1KQV.js","assets/loader-circle-C494cscV.js","assets/InboxPage-BrvZbk3I.js","assets/inboxes-jWYcn3dF.js","assets/trending-up-DE_4cyhU.js","assets/user-round-DF6eHG59.js","assets/voicemail-8ouT582v.js","assets/contactFields.service-CFfwuJQ2.js","assets/calendar.service-Cxk-Ak_l.js","assets/media.service-DZE3d9wr.js","assets/templates.service-DeS31qBi.js","assets/LeadsPage-DwMlVD7h.js","assets/leadLists.service-jTLmOcBM.js","assets/calendar-check-izGZ1nFK.js","assets/ConfigPage-VTYu960p.js","assets/TemplatesPage-qJqjgFYZ.js","assets/BroadcastsPage-DV8f7P3L.js","assets/CalendarPage-CAhajYKW.js","assets/CallsPage-BlF3Xp5a.js","assets/MarketingPage-C1dLouSk.js","assets/trophy-Bp_umYXT.js","assets/ReportsPage-D43ODXyu.js","assets/BrandHomePage-CTYmlTm1.js","assets/PrivacyPolicyPage-B1c3TXO9.js","assets/TermsPage-Dw4KtSA2.js"])))=>i.map(i=>d[i]);
import{e as u,r as Nt,u as At,a as we,O as ye,f as Pt,N as le,B as It,c as jt,b as N,R as St}from"./react-BZRkfIaW.js";import{a as Ot,C as Ut,w as Ae,S as Lt,F as Dt,m as re,_ as zt,i as Mt,g as Bt,d as qt,f as Pe,o as $t,h as Ft,k as Wt,l as Ht,y as Vt,z as Gt,e as Je,j as Kt,x as Ie,T as pe,s as Xt,v as me,A as _e,b as Zt,t as Re,n as U,p as Yt,c as Jt,q as je,u as Se}from"./firebase-CXoVJukC.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))s(r);new MutationObserver(r=>{for(const a of r)if(a.type==="childList")for(const i of a.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&s(i)}).observe(document,{childList:!0,subtree:!0});function n(r){const a={};return r.integrity&&(a.integrity=r.integrity),r.referrerPolicy&&(a.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?a.credentials="include":r.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function s(r){if(r.ep)return;r.ep=!0;const a=n(r);fetch(r.href,a)}})();var Qe={exports:{}},ae={};/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var Qt=u,en=Symbol.for("react.element"),tn=Symbol.for("react.fragment"),nn=Object.prototype.hasOwnProperty,sn=Qt.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,rn={key:!0,ref:!0,__self:!0,__source:!0};function et(t,e,n){var s,r={},a=null,i=null;n!==void 0&&(a=""+n),e.key!==void 0&&(a=""+e.key),e.ref!==void 0&&(i=e.ref);for(s in e)nn.call(e,s)&&!rn.hasOwnProperty(s)&&(r[s]=e[s]);if(t&&t.defaultProps)for(s in e=t.defaultProps,e)r[s]===void 0&&(r[s]=e[s]);return{$$typeof:en,type:t,key:a,ref:i,props:r,_owner:sn.current}}ae.Fragment=tn;ae.jsx=et;ae.jsxs=et;Qe.exports=ae;var o=Qe.exports,ge={},Oe=Nt;ge.createRoot=Oe.createRoot,ge.hydrateRoot=Oe.hydrateRoot;const an="modulepreload",on=function(t){return"/"+t},Ue={},S=function(e,n,s){let r=Promise.resolve();if(n&&n.length>0){document.getElementsByTagName("link");const i=document.querySelector("meta[property=csp-nonce]"),l=(i==null?void 0:i.nonce)||(i==null?void 0:i.getAttribute("nonce"));r=Promise.allSettled(n.map(c=>{if(c=on(c),c in Ue)return;Ue[c]=!0;const d=c.endsWith(".css"),m=d?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${m}`))return;const p=document.createElement("link");if(p.rel=d?"stylesheet":an,d||(p.as="script"),p.crossOrigin="",p.href=c,l&&p.setAttribute("nonce",l),document.head.appendChild(p),d)return new Promise((f,_)=>{p.addEventListener("load",f),p.addEventListener("error",()=>_(new Error(`Unable to preload CSS for ${c}`)))})}))}function a(i){const l=new Event("vite:preloadError",{cancelable:!0});if(l.payload=i,window.dispatchEvent(l),!l.defaultPrevented)throw i}return r.then(i=>{for(const l of i||[])l.status==="rejected"&&a(l.reason);return e().catch(a)})};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const tt="firebasestorage.googleapis.com",nt="storageBucket",cn=2*60*1e3,ln=10*60*1e3,un=1e3;/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class C extends Dt{constructor(e,n,s=0){super(ue(e),`Firebase Storage: ${n} (${ue(e)})`),this.status_=s,this.customData={serverResponse:null},this._baseMessage=this.message,Object.setPrototypeOf(this,C.prototype)}get status(){return this.status_}set status(e){this.status_=e}_codeEquals(e){return ue(e)===this.code}get serverResponse(){return this.customData.serverResponse}set serverResponse(e){this.customData.serverResponse=e,this.customData.serverResponse?this.message=`${this._baseMessage}
${this.customData.serverResponse}`:this.message=this._baseMessage}}var k;(function(t){t.UNKNOWN="unknown",t.OBJECT_NOT_FOUND="object-not-found",t.BUCKET_NOT_FOUND="bucket-not-found",t.PROJECT_NOT_FOUND="project-not-found",t.QUOTA_EXCEEDED="quota-exceeded",t.UNAUTHENTICATED="unauthenticated",t.UNAUTHORIZED="unauthorized",t.UNAUTHORIZED_APP="unauthorized-app",t.RETRY_LIMIT_EXCEEDED="retry-limit-exceeded",t.INVALID_CHECKSUM="invalid-checksum",t.CANCELED="canceled",t.INVALID_EVENT_NAME="invalid-event-name",t.INVALID_URL="invalid-url",t.INVALID_DEFAULT_BUCKET="invalid-default-bucket",t.NO_DEFAULT_BUCKET="no-default-bucket",t.CANNOT_SLICE_BLOB="cannot-slice-blob",t.SERVER_FILE_WRONG_SIZE="server-file-wrong-size",t.NO_DOWNLOAD_URL="no-download-url",t.INVALID_ARGUMENT="invalid-argument",t.INVALID_ARGUMENT_COUNT="invalid-argument-count",t.APP_DELETED="app-deleted",t.INVALID_ROOT_OPERATION="invalid-root-operation",t.INVALID_FORMAT="invalid-format",t.INTERNAL_ERROR="internal-error",t.UNSUPPORTED_ENVIRONMENT="unsupported-environment"})(k||(k={}));function ue(t){return"storage/"+t}function ve(){const t="An unknown error occurred, please check the error payload for server response.";return new C(k.UNKNOWN,t)}function dn(t){return new C(k.OBJECT_NOT_FOUND,"Object '"+t+"' does not exist.")}function hn(t){return new C(k.QUOTA_EXCEEDED,"Quota for bucket '"+t+"' exceeded, please view quota on https://firebase.google.com/pricing/.")}function fn(){const t="User is not authenticated, please authenticate using Firebase Authentication and try again.";return new C(k.UNAUTHENTICATED,t)}function pn(){return new C(k.UNAUTHORIZED_APP,"This app does not have permission to access Firebase Storage on this project.")}function mn(t){return new C(k.UNAUTHORIZED,"User does not have permission to access '"+t+"'.")}function st(){return new C(k.RETRY_LIMIT_EXCEEDED,"Max retry time for operation exceeded, please try again.")}function rt(){return new C(k.CANCELED,"User canceled the upload/download.")}function _n(t){return new C(k.INVALID_URL,"Invalid URL '"+t+"'.")}function gn(t){return new C(k.INVALID_DEFAULT_BUCKET,"Invalid default bucket '"+t+"'.")}function bn(){return new C(k.NO_DEFAULT_BUCKET,"No default bucket found. Did you set the '"+nt+"' property when initializing the app?")}function at(){return new C(k.CANNOT_SLICE_BLOB,"Cannot slice blob for upload. Please retry the upload.")}function xn(){return new C(k.SERVER_FILE_WRONG_SIZE,"Server recorded incorrect upload file size, please retry the upload.")}function wn(){return new C(k.NO_DOWNLOAD_URL,"The given file does not have any download URLs.")}function yn(t){return new C(k.UNSUPPORTED_ENVIRONMENT,`${t} is missing. Make sure to install the required polyfills. See https://firebase.google.com/docs/web/environments-js-sdk#polyfills for more information.`)}function be(t){return new C(k.INVALID_ARGUMENT,t)}function ot(){return new C(k.APP_DELETED,"The Firebase app was deleted.")}function Rn(t){return new C(k.INVALID_ROOT_OPERATION,"The operation '"+t+"' cannot be performed on a root reference, create a non-root reference using child, such as .child('file.png').")}function Z(t,e){return new C(k.INVALID_FORMAT,"String does not match format '"+t+"': "+e)}function X(t){throw new C(k.INTERNAL_ERROR,"Internal error: "+t)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class O{constructor(e,n){this.bucket=e,this.path_=n}get path(){return this.path_}get isRoot(){return this.path.length===0}fullServerUrl(){const e=encodeURIComponent;return"/b/"+e(this.bucket)+"/o/"+e(this.path)}bucketOnlyServerUrl(){return"/b/"+encodeURIComponent(this.bucket)+"/o"}static makeFromBucketSpec(e,n){let s;try{s=O.makeFromUrl(e,n)}catch{return new O(e,"")}if(s.path==="")return s;throw gn(e)}static makeFromUrl(e,n){let s=null;const r="([A-Za-z0-9.\\-_]+)";function a(h){h.path.charAt(h.path.length-1)==="/"&&(h.path_=h.path_.slice(0,-1))}const i="(/(.*))?$",l=new RegExp("^gs://"+r+i,"i"),c={bucket:1,path:3};function d(h){h.path_=decodeURIComponent(h.path)}const m="v[A-Za-z0-9_]+",p=n.replace(/[.]/g,"\\."),f="(/([^?#]*).*)?$",_=new RegExp(`^https?://${p}/${m}/b/${r}/o${f}`,"i"),x={bucket:1,path:3},R=n===tt?"(?:storage.googleapis.com|storage.cloud.google.com)":n,y="([^?#]*)",A=new RegExp(`^https?://${R}/${r}/${y}`,"i"),T=[{regex:l,indices:c,postModify:a},{regex:_,indices:x,postModify:d},{regex:A,indices:{bucket:1,path:2},postModify:d}];for(let h=0;h<T.length;h++){const g=T[h],v=g.regex.exec(e);if(v){const b=v[g.indices.bucket];let w=v[g.indices.path];w||(w=""),s=new O(b,w),g.postModify(s);break}}if(s==null)throw _n(e);return s}}class vn{constructor(e){this.promise_=Promise.reject(e)}getPromise(){return this.promise_}cancel(e=!1){}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function kn(t,e,n){let s=1,r=null,a=null,i=!1,l=0;function c(){return l===2}let d=!1;function m(...y){d||(d=!0,e.apply(null,y))}function p(y){r=setTimeout(()=>{r=null,t(_,c())},y)}function f(){a&&clearTimeout(a)}function _(y,...A){if(d){f();return}if(y){f(),m.call(null,y,...A);return}if(c()||i){f(),m.call(null,y,...A);return}s<64&&(s*=2);let T;l===1?(l=2,T=0):T=(s+Math.random())*1e3,p(T)}let x=!1;function R(y){x||(x=!0,f(),!d&&(r!==null?(y||(l=2),clearTimeout(r),p(0)):y||(l=1)))}return p(0),a=setTimeout(()=>{i=!0,R(!0)},n),R}function Tn(t){t(!1)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Cn(t){return t!==void 0}function En(t){return typeof t=="function"}function Nn(t){return typeof t=="object"&&!Array.isArray(t)}function oe(t){return typeof t=="string"||t instanceof String}function Le(t){return ke()&&t instanceof Blob}function ke(){return typeof Blob<"u"}function De(t,e,n,s){if(s<e)throw be(`Invalid value for '${t}'. Expected ${e} or greater.`);if(s>n)throw be(`Invalid value for '${t}'. Expected ${n} or less.`)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Y(t,e,n){let s=e;return n==null&&(s=`https://${e}`),`${n}://${s}/v0${t}`}function it(t){const e=encodeURIComponent;let n="?";for(const s in t)if(t.hasOwnProperty(s)){const r=e(s)+"="+e(t[s]);n=n+r+"&"}return n=n.slice(0,-1),n}var q;(function(t){t[t.NO_ERROR=0]="NO_ERROR",t[t.NETWORK_ERROR=1]="NETWORK_ERROR",t[t.ABORT=2]="ABORT"})(q||(q={}));/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ct(t,e){const n=t>=500&&t<600,r=[408,429].indexOf(t)!==-1,a=e.indexOf(t)!==-1;return n||r||a}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class An{constructor(e,n,s,r,a,i,l,c,d,m,p,f=!0){this.url_=e,this.method_=n,this.headers_=s,this.body_=r,this.successCodes_=a,this.additionalRetryCodes_=i,this.callback_=l,this.errorCallback_=c,this.timeout_=d,this.progressCallback_=m,this.connectionFactory_=p,this.retry=f,this.pendingConnection_=null,this.backoffId_=null,this.canceled_=!1,this.appDelete_=!1,this.promise_=new Promise((_,x)=>{this.resolve_=_,this.reject_=x,this.start_()})}start_(){const e=(s,r)=>{if(r){s(!1,new ee(!1,null,!0));return}const a=this.connectionFactory_();this.pendingConnection_=a;const i=l=>{const c=l.loaded,d=l.lengthComputable?l.total:-1;this.progressCallback_!==null&&this.progressCallback_(c,d)};this.progressCallback_!==null&&a.addUploadProgressListener(i),a.send(this.url_,this.method_,this.body_,this.headers_).then(()=>{this.progressCallback_!==null&&a.removeUploadProgressListener(i),this.pendingConnection_=null;const l=a.getErrorCode()===q.NO_ERROR,c=a.getStatus();if(!l||ct(c,this.additionalRetryCodes_)&&this.retry){const m=a.getErrorCode()===q.ABORT;s(!1,new ee(!1,null,m));return}const d=this.successCodes_.indexOf(c)!==-1;s(!0,new ee(d,a))})},n=(s,r)=>{const a=this.resolve_,i=this.reject_,l=r.connection;if(r.wasSuccessCode)try{const c=this.callback_(l,l.getResponse());Cn(c)?a(c):a()}catch(c){i(c)}else if(l!==null){const c=ve();c.serverResponse=l.getErrorText(),this.errorCallback_?i(this.errorCallback_(l,c)):i(c)}else if(r.canceled){const c=this.appDelete_?ot():rt();i(c)}else{const c=st();i(c)}};this.canceled_?n(!1,new ee(!1,null,!0)):this.backoffId_=kn(e,n,this.timeout_)}getPromise(){return this.promise_}cancel(e){this.canceled_=!0,this.appDelete_=e||!1,this.backoffId_!==null&&Tn(this.backoffId_),this.pendingConnection_!==null&&this.pendingConnection_.abort()}}class ee{constructor(e,n,s){this.wasSuccessCode=e,this.connection=n,this.canceled=!!s}}function Pn(t,e){e!==null&&e.length>0&&(t.Authorization="Firebase "+e)}function In(t,e){t["X-Firebase-Storage-Version"]="webjs/"+(e??"AppManager")}function jn(t,e){e&&(t["X-Firebase-GMPID"]=e)}function Sn(t,e){e!==null&&(t["X-Firebase-AppCheck"]=e)}function On(t,e,n,s,r,a,i=!0){const l=it(t.urlParams),c=t.url+l,d=Object.assign({},t.headers);return jn(d,e),Pn(d,n),In(d,a),Sn(d,s),new An(c,t.method,d,t.body,t.successCodes,t.additionalRetryCodes,t.handler,t.errorHandler,t.timeout,t.progressCallback,r,i)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Un(){return typeof BlobBuilder<"u"?BlobBuilder:typeof WebKitBlobBuilder<"u"?WebKitBlobBuilder:void 0}function Ln(...t){const e=Un();if(e!==void 0){const n=new e;for(let s=0;s<t.length;s++)n.append(t[s]);return n.getBlob()}else{if(ke())return new Blob(t);throw new C(k.UNSUPPORTED_ENVIRONMENT,"This browser doesn't seem to support creating Blobs")}}function Dn(t,e,n){return t.webkitSlice?t.webkitSlice(e,n):t.mozSlice?t.mozSlice(e,n):t.slice?t.slice(e,n):null}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function zn(t){if(typeof atob>"u")throw yn("base-64");return atob(t)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const D={RAW:"raw",BASE64:"base64",BASE64URL:"base64url",DATA_URL:"data_url"};class de{constructor(e,n){this.data=e,this.contentType=n||null}}function Mn(t,e){switch(t){case D.RAW:return new de(lt(e));case D.BASE64:case D.BASE64URL:return new de(ut(t,e));case D.DATA_URL:return new de(qn(e),$n(e))}throw ve()}function lt(t){const e=[];for(let n=0;n<t.length;n++){let s=t.charCodeAt(n);if(s<=127)e.push(s);else if(s<=2047)e.push(192|s>>6,128|s&63);else if((s&64512)===55296)if(!(n<t.length-1&&(t.charCodeAt(n+1)&64512)===56320))e.push(239,191,189);else{const a=s,i=t.charCodeAt(++n);s=65536|(a&1023)<<10|i&1023,e.push(240|s>>18,128|s>>12&63,128|s>>6&63,128|s&63)}else(s&64512)===56320?e.push(239,191,189):e.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(e)}function Bn(t){let e;try{e=decodeURIComponent(t)}catch{throw Z(D.DATA_URL,"Malformed data URL.")}return lt(e)}function ut(t,e){switch(t){case D.BASE64:{const r=e.indexOf("-")!==-1,a=e.indexOf("_")!==-1;if(r||a)throw Z(t,"Invalid character '"+(r?"-":"_")+"' found: is it base64url encoded?");break}case D.BASE64URL:{const r=e.indexOf("+")!==-1,a=e.indexOf("/")!==-1;if(r||a)throw Z(t,"Invalid character '"+(r?"+":"/")+"' found: is it base64 encoded?");e=e.replace(/-/g,"+").replace(/_/g,"/");break}}let n;try{n=zn(e)}catch(r){throw r.message.includes("polyfill")?r:Z(t,"Invalid character found")}const s=new Uint8Array(n.length);for(let r=0;r<n.length;r++)s[r]=n.charCodeAt(r);return s}class dt{constructor(e){this.base64=!1,this.contentType=null;const n=e.match(/^data:([^,]+)?,/);if(n===null)throw Z(D.DATA_URL,"Must be formatted 'data:[<mediatype>][;base64],<data>");const s=n[1]||null;s!=null&&(this.base64=Fn(s,";base64"),this.contentType=this.base64?s.substring(0,s.length-7):s),this.rest=e.substring(e.indexOf(",")+1)}}function qn(t){const e=new dt(t);return e.base64?ut(D.BASE64,e.rest):Bn(e.rest)}function $n(t){return new dt(t).contentType}function Fn(t,e){return t.length>=e.length?t.substring(t.length-e.length)===e:!1}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class B{constructor(e,n){let s=0,r="";Le(e)?(this.data_=e,s=e.size,r=e.type):e instanceof ArrayBuffer?(n?this.data_=new Uint8Array(e):(this.data_=new Uint8Array(e.byteLength),this.data_.set(new Uint8Array(e))),s=this.data_.length):e instanceof Uint8Array&&(n?this.data_=e:(this.data_=new Uint8Array(e.length),this.data_.set(e)),s=e.length),this.size_=s,this.type_=r}size(){return this.size_}type(){return this.type_}slice(e,n){if(Le(this.data_)){const s=this.data_,r=Dn(s,e,n);return r===null?null:new B(r)}else{const s=new Uint8Array(this.data_.buffer,e,n-e);return new B(s,!0)}}static getBlob(...e){if(ke()){const n=e.map(s=>s instanceof B?s.data_:s);return new B(Ln.apply(null,n))}else{const n=e.map(i=>oe(i)?Mn(D.RAW,i).data:i.data_);let s=0;n.forEach(i=>{s+=i.byteLength});const r=new Uint8Array(s);let a=0;return n.forEach(i=>{for(let l=0;l<i.length;l++)r[a++]=i[l]}),new B(r,!0)}}uploadData(){return this.data_}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ht(t){let e;try{e=JSON.parse(t)}catch{return null}return Nn(e)?e:null}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Wn(t){if(t.length===0)return null;const e=t.lastIndexOf("/");return e===-1?"":t.slice(0,e)}function Hn(t,e){const n=e.split("/").filter(s=>s.length>0).join("/");return t.length===0?n:t+"/"+n}function ft(t){const e=t.lastIndexOf("/",t.length-2);return e===-1?t:t.slice(e+1)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Vn(t,e){return e}class I{constructor(e,n,s,r){this.server=e,this.local=n||e,this.writable=!!s,this.xform=r||Vn}}let te=null;function Gn(t){return!oe(t)||t.length<2?t:ft(t)}function pt(){if(te)return te;const t=[];t.push(new I("bucket")),t.push(new I("generation")),t.push(new I("metageneration")),t.push(new I("name","fullPath",!0));function e(a,i){return Gn(i)}const n=new I("name");n.xform=e,t.push(n);function s(a,i){return i!==void 0?Number(i):i}const r=new I("size");return r.xform=s,t.push(r),t.push(new I("timeCreated")),t.push(new I("updated")),t.push(new I("md5Hash",null,!0)),t.push(new I("cacheControl",null,!0)),t.push(new I("contentDisposition",null,!0)),t.push(new I("contentEncoding",null,!0)),t.push(new I("contentLanguage",null,!0)),t.push(new I("contentType",null,!0)),t.push(new I("metadata","customMetadata",!0)),te=t,te}function Kn(t,e){function n(){const s=t.bucket,r=t.fullPath,a=new O(s,r);return e._makeStorageReference(a)}Object.defineProperty(t,"ref",{get:n})}function Xn(t,e,n){const s={};s.type="file";const r=n.length;for(let a=0;a<r;a++){const i=n[a];s[i.local]=i.xform(s,e[i.server])}return Kn(s,t),s}function mt(t,e,n){const s=ht(e);return s===null?null:Xn(t,s,n)}function Zn(t,e,n,s){const r=ht(e);if(r===null||!oe(r.downloadTokens))return null;const a=r.downloadTokens;if(a.length===0)return null;const i=encodeURIComponent;return a.split(",").map(d=>{const m=t.bucket,p=t.fullPath,f="/b/"+i(m)+"/o/"+i(p),_=Y(f,n,s),x=it({alt:"media",token:d});return _+x})[0]}function _t(t,e){const n={},s=e.length;for(let r=0;r<s;r++){const a=e[r];a.writable&&(n[a.server]=t[a.local])}return JSON.stringify(n)}class G{constructor(e,n,s,r){this.url=e,this.method=n,this.handler=s,this.timeout=r,this.urlParams={},this.headers={},this.body=null,this.errorHandler=null,this.progressCallback=null,this.successCodes=[200],this.additionalRetryCodes=[]}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function M(t){if(!t)throw ve()}function Te(t,e){function n(s,r){const a=mt(t,r,e);return M(a!==null),a}return n}function Yn(t,e){function n(s,r){const a=mt(t,r,e);return M(a!==null),Zn(a,r,t.host,t._protocol)}return n}function J(t){function e(n,s){let r;return n.getStatus()===401?n.getErrorText().includes("Firebase App Check token is invalid")?r=pn():r=fn():n.getStatus()===402?r=hn(t.bucket):n.getStatus()===403?r=mn(t.path):r=s,r.status=n.getStatus(),r.serverResponse=s.serverResponse,r}return e}function gt(t){const e=J(t);function n(s,r){let a=e(s,r);return s.getStatus()===404&&(a=dn(t.path)),a.serverResponse=r.serverResponse,a}return n}function Jn(t,e,n){const s=e.fullServerUrl(),r=Y(s,t.host,t._protocol),a="GET",i=t.maxOperationRetryTime,l=new G(r,a,Te(t,n),i);return l.errorHandler=gt(e),l}function Qn(t,e,n){const s=e.fullServerUrl(),r=Y(s,t.host,t._protocol),a="GET",i=t.maxOperationRetryTime,l=new G(r,a,Yn(t,n),i);return l.errorHandler=gt(e),l}function es(t,e){return t&&t.contentType||e&&e.type()||"application/octet-stream"}function bt(t,e,n){const s=Object.assign({},n);return s.fullPath=t.path,s.size=e.size(),s.contentType||(s.contentType=es(null,e)),s}function ts(t,e,n,s,r){const a=e.bucketOnlyServerUrl(),i={"X-Goog-Upload-Protocol":"multipart"};function l(){let T="";for(let h=0;h<2;h++)T=T+Math.random().toString().slice(2);return T}const c=l();i["Content-Type"]="multipart/related; boundary="+c;const d=bt(e,s,r),m=_t(d,n),p="--"+c+`\r
Content-Type: application/json; charset=utf-8\r
\r
`+m+`\r
--`+c+`\r
Content-Type: `+d.contentType+`\r
\r
`,f=`\r
--`+c+"--",_=B.getBlob(p,s,f);if(_===null)throw at();const x={name:d.fullPath},R=Y(a,t.host,t._protocol),y="POST",A=t.maxUploadRetryTime,P=new G(R,y,Te(t,n),A);return P.urlParams=x,P.headers=i,P.body=_.uploadData(),P.errorHandler=J(e),P}class ne{constructor(e,n,s,r){this.current=e,this.total=n,this.finalized=!!s,this.metadata=r||null}}function Ce(t,e){let n=null;try{n=t.getResponseHeader("X-Goog-Upload-Status")}catch{M(!1)}return M(!!n&&(e||["active"]).indexOf(n)!==-1),n}function ns(t,e,n,s,r){const a=e.bucketOnlyServerUrl(),i=bt(e,s,r),l={name:i.fullPath},c=Y(a,t.host,t._protocol),d="POST",m={"X-Goog-Upload-Protocol":"resumable","X-Goog-Upload-Command":"start","X-Goog-Upload-Header-Content-Length":`${s.size()}`,"X-Goog-Upload-Header-Content-Type":i.contentType,"Content-Type":"application/json; charset=utf-8"},p=_t(i,n),f=t.maxUploadRetryTime;function _(R){Ce(R);let y;try{y=R.getResponseHeader("X-Goog-Upload-URL")}catch{M(!1)}return M(oe(y)),y}const x=new G(c,d,_,f);return x.urlParams=l,x.headers=m,x.body=p,x.errorHandler=J(e),x}function ss(t,e,n,s){const r={"X-Goog-Upload-Command":"query"};function a(d){const m=Ce(d,["active","final"]);let p=null;try{p=d.getResponseHeader("X-Goog-Upload-Size-Received")}catch{M(!1)}p||M(!1);const f=Number(p);return M(!isNaN(f)),new ne(f,s.size(),m==="final")}const i="POST",l=t.maxUploadRetryTime,c=new G(n,i,a,l);return c.headers=r,c.errorHandler=J(e),c}const ze=256*1024;function rs(t,e,n,s,r,a,i,l){const c=new ne(0,0);if(i?(c.current=i.current,c.total=i.total):(c.current=0,c.total=s.size()),s.size()!==c.total)throw xn();const d=c.total-c.current;let m=d;r>0&&(m=Math.min(m,r));const p=c.current,f=p+m;let _="";m===0?_="finalize":d===m?_="upload, finalize":_="upload";const x={"X-Goog-Upload-Command":_,"X-Goog-Upload-Offset":`${c.current}`},R=s.slice(p,f);if(R===null)throw at();function y(h,g){const v=Ce(h,["active","final"]),b=c.current+m,w=s.size();let E;return v==="final"?E=Te(e,a)(h,g):E=null,new ne(b,w,v==="final",E)}const A="POST",P=e.maxUploadRetryTime,T=new G(n,A,y,P);return T.headers=x,T.body=R.uploadData(),T.progressCallback=l||null,T.errorHandler=J(t),T}const j={RUNNING:"running",PAUSED:"paused",SUCCESS:"success",CANCELED:"canceled",ERROR:"error"};function he(t){switch(t){case"running":case"pausing":case"canceling":return j.RUNNING;case"paused":return j.PAUSED;case"success":return j.SUCCESS;case"canceled":return j.CANCELED;case"error":return j.ERROR;default:return j.ERROR}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class as{constructor(e,n,s){if(En(e)||n!=null||s!=null)this.next=e,this.error=n??void 0,this.complete=s??void 0;else{const a=e;this.next=a.next,this.error=a.error,this.complete=a.complete}}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function W(t){return(...e)=>{Promise.resolve().then(()=>t(...e))}}class os{constructor(){this.sent_=!1,this.xhr_=new XMLHttpRequest,this.initXhr(),this.errorCode_=q.NO_ERROR,this.sendPromise_=new Promise(e=>{this.xhr_.addEventListener("abort",()=>{this.errorCode_=q.ABORT,e()}),this.xhr_.addEventListener("error",()=>{this.errorCode_=q.NETWORK_ERROR,e()}),this.xhr_.addEventListener("load",()=>{e()})})}send(e,n,s,r){if(this.sent_)throw X("cannot .send() more than once");if(this.sent_=!0,this.xhr_.open(n,e,!0),r!==void 0)for(const a in r)r.hasOwnProperty(a)&&this.xhr_.setRequestHeader(a,r[a].toString());return s!==void 0?this.xhr_.send(s):this.xhr_.send(),this.sendPromise_}getErrorCode(){if(!this.sent_)throw X("cannot .getErrorCode() before sending");return this.errorCode_}getStatus(){if(!this.sent_)throw X("cannot .getStatus() before sending");try{return this.xhr_.status}catch{return-1}}getResponse(){if(!this.sent_)throw X("cannot .getResponse() before sending");return this.xhr_.response}getErrorText(){if(!this.sent_)throw X("cannot .getErrorText() before sending");return this.xhr_.statusText}abort(){this.xhr_.abort()}getResponseHeader(e){return this.xhr_.getResponseHeader(e)}addUploadProgressListener(e){this.xhr_.upload!=null&&this.xhr_.upload.addEventListener("progress",e)}removeUploadProgressListener(e){this.xhr_.upload!=null&&this.xhr_.upload.removeEventListener("progress",e)}}class is extends os{initXhr(){this.xhr_.responseType="text"}}function H(){return new is}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class cs{constructor(e,n,s=null){this._transferred=0,this._needToFetchStatus=!1,this._needToFetchMetadata=!1,this._observers=[],this._error=void 0,this._uploadUrl=void 0,this._request=void 0,this._chunkMultiplier=1,this._resolve=void 0,this._reject=void 0,this._ref=e,this._blob=n,this._metadata=s,this._mappings=pt(),this._resumable=this._shouldDoResumable(this._blob),this._state="running",this._errorHandler=r=>{if(this._request=void 0,this._chunkMultiplier=1,r._codeEquals(k.CANCELED))this._needToFetchStatus=!0,this.completeTransitions_();else{const a=this.isExponentialBackoffExpired();if(ct(r.status,[]))if(a)r=st();else{this.sleepTime=Math.max(this.sleepTime*2,un),this._needToFetchStatus=!0,this.completeTransitions_();return}this._error=r,this._transition("error")}},this._metadataErrorHandler=r=>{this._request=void 0,r._codeEquals(k.CANCELED)?this.completeTransitions_():(this._error=r,this._transition("error"))},this.sleepTime=0,this.maxSleepTime=this._ref.storage.maxUploadRetryTime,this._promise=new Promise((r,a)=>{this._resolve=r,this._reject=a,this._start()}),this._promise.then(null,()=>{})}isExponentialBackoffExpired(){return this.sleepTime>this.maxSleepTime}_makeProgressCallback(){const e=this._transferred;return n=>this._updateProgress(e+n)}_shouldDoResumable(e){return e.size()>256*1024}_start(){this._state==="running"&&this._request===void 0&&(this._resumable?this._uploadUrl===void 0?this._createResumable():this._needToFetchStatus?this._fetchStatus():this._needToFetchMetadata?this._fetchMetadata():this.pendingTimeout=setTimeout(()=>{this.pendingTimeout=void 0,this._continueUpload()},this.sleepTime):this._oneShotUpload())}_resolveToken(e){Promise.all([this._ref.storage._getAuthToken(),this._ref.storage._getAppCheckToken()]).then(([n,s])=>{switch(this._state){case"running":e(n,s);break;case"canceling":this._transition("canceled");break;case"pausing":this._transition("paused");break}})}_createResumable(){this._resolveToken((e,n)=>{const s=ns(this._ref.storage,this._ref._location,this._mappings,this._blob,this._metadata),r=this._ref.storage._makeRequest(s,H,e,n);this._request=r,r.getPromise().then(a=>{this._request=void 0,this._uploadUrl=a,this._needToFetchStatus=!1,this.completeTransitions_()},this._errorHandler)})}_fetchStatus(){const e=this._uploadUrl;this._resolveToken((n,s)=>{const r=ss(this._ref.storage,this._ref._location,e,this._blob),a=this._ref.storage._makeRequest(r,H,n,s);this._request=a,a.getPromise().then(i=>{i=i,this._request=void 0,this._updateProgress(i.current),this._needToFetchStatus=!1,i.finalized&&(this._needToFetchMetadata=!0),this.completeTransitions_()},this._errorHandler)})}_continueUpload(){const e=ze*this._chunkMultiplier,n=new ne(this._transferred,this._blob.size()),s=this._uploadUrl;this._resolveToken((r,a)=>{let i;try{i=rs(this._ref._location,this._ref.storage,s,this._blob,e,this._mappings,n,this._makeProgressCallback())}catch(c){this._error=c,this._transition("error");return}const l=this._ref.storage._makeRequest(i,H,r,a,!1);this._request=l,l.getPromise().then(c=>{this._increaseMultiplier(),this._request=void 0,this._updateProgress(c.current),c.finalized?(this._metadata=c.metadata,this._transition("success")):this.completeTransitions_()},this._errorHandler)})}_increaseMultiplier(){ze*this._chunkMultiplier*2<32*1024*1024&&(this._chunkMultiplier*=2)}_fetchMetadata(){this._resolveToken((e,n)=>{const s=Jn(this._ref.storage,this._ref._location,this._mappings),r=this._ref.storage._makeRequest(s,H,e,n);this._request=r,r.getPromise().then(a=>{this._request=void 0,this._metadata=a,this._transition("success")},this._metadataErrorHandler)})}_oneShotUpload(){this._resolveToken((e,n)=>{const s=ts(this._ref.storage,this._ref._location,this._mappings,this._blob,this._metadata),r=this._ref.storage._makeRequest(s,H,e,n);this._request=r,r.getPromise().then(a=>{this._request=void 0,this._metadata=a,this._updateProgress(this._blob.size()),this._transition("success")},this._errorHandler)})}_updateProgress(e){const n=this._transferred;this._transferred=e,this._transferred!==n&&this._notifyObservers()}_transition(e){if(this._state!==e)switch(e){case"canceling":case"pausing":this._state=e,this._request!==void 0?this._request.cancel():this.pendingTimeout&&(clearTimeout(this.pendingTimeout),this.pendingTimeout=void 0,this.completeTransitions_());break;case"running":const n=this._state==="paused";this._state=e,n&&(this._notifyObservers(),this._start());break;case"paused":this._state=e,this._notifyObservers();break;case"canceled":this._error=rt(),this._state=e,this._notifyObservers();break;case"error":this._state=e,this._notifyObservers();break;case"success":this._state=e,this._notifyObservers();break}}completeTransitions_(){switch(this._state){case"pausing":this._transition("paused");break;case"canceling":this._transition("canceled");break;case"running":this._start();break}}get snapshot(){const e=he(this._state);return{bytesTransferred:this._transferred,totalBytes:this._blob.size(),state:e,metadata:this._metadata,task:this,ref:this._ref}}on(e,n,s,r){const a=new as(n||void 0,s||void 0,r||void 0);return this._addObserver(a),()=>{this._removeObserver(a)}}then(e,n){return this._promise.then(e,n)}catch(e){return this.then(null,e)}_addObserver(e){this._observers.push(e),this._notifyObserver(e)}_removeObserver(e){const n=this._observers.indexOf(e);n!==-1&&this._observers.splice(n,1)}_notifyObservers(){this._finishPromise(),this._observers.slice().forEach(n=>{this._notifyObserver(n)})}_finishPromise(){if(this._resolve!==void 0){let e=!0;switch(he(this._state)){case j.SUCCESS:W(this._resolve.bind(null,this.snapshot))();break;case j.CANCELED:case j.ERROR:const n=this._reject;W(n.bind(null,this._error))();break;default:e=!1;break}e&&(this._resolve=void 0,this._reject=void 0)}}_notifyObserver(e){switch(he(this._state)){case j.RUNNING:case j.PAUSED:e.next&&W(e.next.bind(e,this.snapshot))();break;case j.SUCCESS:e.complete&&W(e.complete.bind(e))();break;case j.CANCELED:case j.ERROR:e.error&&W(e.error.bind(e,this._error))();break;default:e.error&&W(e.error.bind(e,this._error))()}}resume(){const e=this._state==="paused"||this._state==="pausing";return e&&this._transition("running"),e}pause(){const e=this._state==="running";return e&&this._transition("pausing"),e}cancel(){const e=this._state==="running"||this._state==="pausing";return e&&this._transition("canceling"),e}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ${constructor(e,n){this._service=e,n instanceof O?this._location=n:this._location=O.makeFromUrl(n,e.host)}toString(){return"gs://"+this._location.bucket+"/"+this._location.path}_newRef(e,n){return new $(e,n)}get root(){const e=new O(this._location.bucket,"");return this._newRef(this._service,e)}get bucket(){return this._location.bucket}get fullPath(){return this._location.path}get name(){return ft(this._location.path)}get storage(){return this._service}get parent(){const e=Wn(this._location.path);if(e===null)return null;const n=new O(this._location.bucket,e);return new $(this._service,n)}_throwIfRoot(e){if(this._location.path==="")throw Rn(e)}}function ls(t,e,n){return t._throwIfRoot("uploadBytesResumable"),new cs(t,new B(e),n)}function us(t){t._throwIfRoot("getDownloadURL");const e=Qn(t.storage,t._location,pt());return t.storage.makeRequestWithTokens(e,H).then(n=>{if(n===null)throw wn();return n})}function ds(t,e){const n=Hn(t._location.path,e),s=new O(t._location.bucket,n);return new $(t.storage,s)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function hs(t){return/^[A-Za-z]+:\/\//.test(t)}function fs(t,e){return new $(t,e)}function xt(t,e){if(t instanceof Ee){const n=t;if(n._bucket==null)throw bn();const s=new $(n,n._bucket);return e!=null?xt(s,e):s}else return e!==void 0?ds(t,e):t}function ps(t,e){if(e&&hs(e)){if(t instanceof Ee)return fs(t,e);throw be("To use ref(service, url), the first argument must be a Storage instance.")}else return xt(t,e)}function Me(t,e){const n=e==null?void 0:e[nt];return n==null?null:O.makeFromBucketSpec(n,t)}function ms(t,e,n,s={}){t.host=`${e}:${n}`,t._protocol="http";const{mockUserToken:r}=s;r&&(t._overrideAuthToken=typeof r=="string"?r:qt(r,t.app.options.projectId))}class Ee{constructor(e,n,s,r,a){this.app=e,this._authProvider=n,this._appCheckProvider=s,this._url=r,this._firebaseVersion=a,this._bucket=null,this._host=tt,this._protocol="https",this._appId=null,this._deleted=!1,this._maxOperationRetryTime=cn,this._maxUploadRetryTime=ln,this._requests=new Set,r!=null?this._bucket=O.makeFromBucketSpec(r,this._host):this._bucket=Me(this._host,this.app.options)}get host(){return this._host}set host(e){this._host=e,this._url!=null?this._bucket=O.makeFromBucketSpec(this._url,e):this._bucket=Me(e,this.app.options)}get maxUploadRetryTime(){return this._maxUploadRetryTime}set maxUploadRetryTime(e){De("time",0,Number.POSITIVE_INFINITY,e),this._maxUploadRetryTime=e}get maxOperationRetryTime(){return this._maxOperationRetryTime}set maxOperationRetryTime(e){De("time",0,Number.POSITIVE_INFINITY,e),this._maxOperationRetryTime=e}async _getAuthToken(){if(this._overrideAuthToken)return this._overrideAuthToken;const e=this._authProvider.getImmediate({optional:!0});if(e){const n=await e.getToken();if(n!==null)return n.accessToken}return null}async _getAppCheckToken(){const e=this._appCheckProvider.getImmediate({optional:!0});return e?(await e.getToken()).token:null}_delete(){return this._deleted||(this._deleted=!0,this._requests.forEach(e=>e.cancel()),this._requests.clear()),Promise.resolve()}_makeStorageReference(e){return new $(this,e)}_makeRequest(e,n,s,r,a=!0){if(this._deleted)return new vn(ot());{const i=On(e,this._appId,s,r,n,this._firebaseVersion,a);return this._requests.add(i),i.getPromise().then(()=>this._requests.delete(i),()=>this._requests.delete(i)),i}}async makeRequestWithTokens(e,n){const[s,r]=await Promise.all([this._getAuthToken(),this._getAppCheckToken()]);return this._makeRequest(e,n,s,r).getPromise()}}const Be="@firebase/storage",qe="0.13.2";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const wt="storage";function Vr(t,e,n){return t=re(t),ls(t,e,n)}function Gr(t){return t=re(t),us(t)}function Kr(t,e){return t=re(t),ps(t,e)}function _s(t=Bt(),e){t=re(t);const s=zt(t,wt).getImmediate({identifier:e}),r=Mt("storage");return r&&gs(s,...r),s}function gs(t,e,n,s={}){ms(t,e,n,s)}function bs(t,{instanceIdentifier:e}){const n=t.getProvider("app").getImmediate(),s=t.getProvider("auth-internal"),r=t.getProvider("app-check-internal");return new Ee(n,s,r,e,Lt)}function xs(){Ot(new Ut(wt,bs,"PUBLIC").setMultipleInstances(!0)),Ae(Be,qe,""),Ae(Be,qe,"esm2017")}xs();const ws={apiKey:"AIzaSyAKKfQbTz50I4MwdmwVn47P9hVyPsiIp4U",authDomain:"crm-conversacional.firebaseapp.com",projectId:"crm-conversacional",storageBucket:"crm-conversacional.firebasestorage.app",messagingSenderId:"353322694551",appId:"1:353322694551:web:98caaf96ec6130879b76d2"},ie=Pe().length===0?$t(ws):Pe()[0],Ne=Ft(ie),ce=Wt(ie),L=Ht(ie,"us-central1"),Xr=_s(ie),ys="empresa_demo";async function Rs(t,e){return(await Vt(Ne,t,e)).user}async function $e(){await Gt(Ne)}async function Fe(t,e=5){let n={};for(let s=0;s<e;s++){if(n=(await t.getIdTokenResult(!0)).claims,typeof n.companyId=="string"&&n.companyId)return n;await new Promise(a=>setTimeout(a,600+s*400))}return n}async function vs(t){var l;let{claims:e}=await t.getIdTokenResult(),n=typeof e.companyId=="string"&&e.companyId?e.companyId:ys;const s=Je(ce,"companies",n,"users",t.uid),r=await Kt(s);if(r.exists())return e.companyId||(await Ie(s,{updatedAt:pe.now()},{merge:!0}),e=await Fe(t),typeof e.companyId=="string"&&e.companyId&&(n=e.companyId)),{...r.data(),id:r.id,companyId:n};const a=pe.now(),i={companyId:n,email:t.email??"",displayName:t.displayName??((l=t.email)==null?void 0:l.split("@")[0])??"Usuario",role:"advisor",active:!0,createdAt:a,updatedAt:a};return await Ie(s,i),await Fe(t),{id:t.uid,...i}}const yt=u.createContext(null);function ks({children:t}){const[e,n]=u.useState(null),[s,r]=u.useState(null),[a,i]=u.useState(!0),[l,c]=u.useState(null);u.useEffect(()=>Xt(Ne,async _=>{if(c(null),_)try{const x=await vs(_);x.active?(n(_),r(x)):(await $e(),c("Tu cuenta está desactivada. Contacta al administrador."),n(null),r(null))}catch(x){console.error("[Auth] Error cargando perfil:",x),c("No se pudo cargar el perfil de usuario."),n(null),r(null)}else n(null),r(null);i(!1)}),[]);const d=u.useCallback(async(f,_)=>{c(null),i(!0);try{await Rs(f,_)}catch(x){const R=Ts(x);throw c(R),i(!1),new Error(R)}},[]),m=u.useCallback(async()=>{await $e()},[]),p={user:e,profile:s,loading:a,error:l,companyId:(s==null?void 0:s.companyId)??null,role:(s==null?void 0:s.role)??null,signIn:d,signOut:m};return o.jsx(yt.Provider,{value:p,children:t})}function Q(){const t=u.useContext(yt);if(!t)throw new Error("useAuthContext debe usarse dentro de <AuthProvider>");return t}function Ts(t){if(typeof t=="object"&&t!==null&&"code"in t){const e=t.code;return{"auth/user-not-found":"No existe una cuenta con ese email.","auth/wrong-password":"Contraseña incorrecta.","auth/invalid-email":"El email no es válido.","auth/too-many-requests":"Demasiados intentos. Espera unos minutos.","auth/user-disabled":"Esta cuenta está desactivada.","auth/invalid-credential":"Credenciales inválidas. Verifica tu email y contraseña.","auth/network-request-failed":"Error de red. Verifica tu conexión."}[e]??`Error de autenticación (${e})`}return"Error inesperado. Intenta nuevamente."}const Cs={sm:"h-4 w-4",md:"h-6 w-6",lg:"h-10 w-10"};function Rt({size:t="md",className:e=""}){return o.jsx("div",{className:`animate-spin rounded-full border-2 border-zinc-600 border-t-violet-500 ${Cs[t]} ${e}`,role:"status","aria-label":"Cargando"})}function Es(){const{user:t,loading:e}=Q(),n=At();return e?o.jsx("div",{className:"flex h-screen items-center justify-center bg-surface",children:o.jsx(Rt,{size:"lg"})}):t?o.jsx(ye,{}):o.jsx(we,{to:"/login",state:{from:n},replace:!0})}function Ns({allowed:t}){const{role:e}=Q();return!e||!t.includes(e)?o.jsx(we,{to:"/dashboard/inbox",replace:!0}):o.jsx(ye,{})}const As=["admin","manager"];function vt(t){return!!t&&As.includes(t)}/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kt=(...t)=>t.filter((e,n,s)=>!!e&&e.trim()!==""&&s.indexOf(e)===n).join(" ").trim();/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ps=t=>t.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Is=t=>t.replace(/^([A-Z])|[\s-_]+(\w)/g,(e,n,s)=>s?s.toUpperCase():n.toLowerCase());/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const We=t=>{const e=Is(t);return e.charAt(0).toUpperCase()+e.slice(1)};/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var fe={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const js=t=>{for(const e in t)if(e.startsWith("aria-")||e==="role"||e==="title")return!0;return!1},Ss=u.createContext({}),Os=()=>u.useContext(Ss),Us=u.forwardRef(({color:t,size:e,strokeWidth:n,absoluteStrokeWidth:s,className:r="",children:a,iconNode:i,...l},c)=>{const{size:d=24,strokeWidth:m=2,absoluteStrokeWidth:p=!1,color:f="currentColor",className:_=""}=Os()??{},x=s??p?Number(n??m)*24/Number(e??d):n??m;return u.createElement("svg",{ref:c,...fe,width:e??d??fe.width,height:e??d??fe.height,stroke:t??f,strokeWidth:x,className:kt("lucide",_,r),...!a&&!js(l)&&{"aria-hidden":"true"},...l},[...i.map(([R,y])=>u.createElement(R,y)),...Array.isArray(a)?a:[a]])});/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const F=(t,e)=>{const n=u.forwardRef(({className:s,...r},a)=>u.createElement(Us,{ref:a,iconNode:e,className:kt(`lucide-${Ps(We(t))}`,`lucide-${t}`,s),...r}));return n.displayName=We(t),n};/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ls=[["path",{d:"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719",key:"1sd12s"}]],Ds=F("message-circle",Ls);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zs=[["path",{d:"M12 19v3",key:"npa21l"}],["path",{d:"M15 9.34V5a3 3 0 0 0-5.68-1.33",key:"1gzdoj"}],["path",{d:"M16.95 16.95A7 7 0 0 1 5 12v-2",key:"cqa7eg"}],["path",{d:"M18.89 13.23A7 7 0 0 0 19 12v-2",key:"16hl24"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M9 9v3a3 3 0 0 0 5.12 2.12",key:"r2i35w"}]],Ms=F("mic-off",zs);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bs=[["path",{d:"M12 19v3",key:"npa21l"}],["path",{d:"M19 10v2a7 7 0 0 1-14 0v-2",key:"1vc78b"}],["rect",{x:"9",y:"2",width:"6",height:"13",rx:"3",key:"s6n7sd"}]],qs=F("mic",Bs);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $s=[["path",{d:"M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272",key:"1wngk7"}],["path",{d:"M22 2 2 22",key:"y4kqgn"}],["path",{d:"M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473",key:"10hv5p"}]],He=F("phone-off",$s);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fs=[["path",{d:"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",key:"9njp5v"}]],Ve=F("phone",Fs);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ws=[["path",{d:"M2 21a8 8 0 0 1 13.292-6",key:"bjp14o"}],["circle",{cx:"10",cy:"8",r:"5",key:"o932ke"}],["path",{d:"M19 16v6",key:"tddt3s"}],["path",{d:"M22 19h-6",key:"vcuq98"}]],Hs=F("user-round-plus",Ws);/**
 * @license lucide-react v1.21.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vs=[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]],Gs=F("x",Vs);function se(t){if(!t)return"";const e=t.replace(/\s/g,""),n=e.match(/^\+57(\d{3})(\d{3})(\d{4})$/);return n?`+57 ${n[1]} ${n[2]} ${n[3]}`:e}function Ks(t,e,n){const[s,r]=u.useState([]);return u.useEffect(()=>{if(!t){r([]);return}const a=me(Zt(ce,"calls"),_e("companyId","==",t),_e("status","==","ringing"));return Re(a,l=>{const d=l.docs.map(m=>({id:m.id,...m.data()})).filter(m=>n||!m.assignedTo||m.assignedTo===e);r(d)},l=>console.error("[useRingingCalls]",l))},[t,e,n]),s}const Xs=U(L,"startAiCall"),Zs=U(L,"startWhatsappCall");async function Ys(t,e,n){return(await Zs({companyId:t,leadId:e,sdpOffer:n})).data.callId}const Js=U(L,"requestCallPermission");async function Zr(t,e){await Js({companyId:t,leadId:e})}const Qs=U(L,"preAcceptWhatsappCall"),er=U(L,"acceptWhatsappCall"),tr=U(L,"rejectWhatsappCall"),nr=U(L,"terminateWhatsappCall");async function sr(t){await Qs(t)}async function rr(t){await er(t)}async function ar(t){await tr(t)}async function or(t){await nr(t)}const ir=U(L,"listRecentCalls");async function Yr(t,e){return(await Xs({companyId:t,leadId:e})).data.callId}async function Jr(t,e=60){return(await ir({companyId:t,limit:e})).data.calls}const cr=[{urls:"stun:stun.l.google.com:19302"}];function Ge(t){return t.iceGatheringState==="complete"?Promise.resolve():new Promise(e=>{const n=()=>{t.iceGatheringState==="complete"&&(t.removeEventListener("icegatheringstatechange",n),e())};t.addEventListener("icegatheringstatechange",n),setTimeout(e,4e3)})}function lr(){const[t,e]=u.useState("idle"),[n,s]=u.useState(null),[r,a]=u.useState(!1),[i,l]=u.useState(null),c=u.useRef(null),d=u.useRef(null),m=u.useRef(null),p=u.useRef(null),f=u.useCallback(()=>{var h,g,v;(h=p.current)==null||h.call(p),p.current=null,(g=c.current)==null||g.close(),c.current=null,(v=d.current)==null||v.getTracks().forEach(b=>b.stop()),d.current=null,m.current&&(m.current.srcObject=null),s(null),a(!1),e("idle")},[]),_=u.useCallback((h,g,v)=>{var b;(b=p.current)==null||b.call(p),p.current=Re(Je(ce,"companies",h,"leads",g,"calls",v),w=>{const E=w.data();if(!E)return;s({...E,id:w.id});const z=c.current;z&&E.sdpAnswer&&!z.currentRemoteDescription&&z.setRemoteDescription({type:"answer",sdp:E.sdpAnswer}).catch(K=>{console.error("[useWhatsappCallSession] setRemoteDescription error:",K)}),E.status==="in-progress"&&e("in-call"),["completed","failed","rejected","missed"].includes(E.status)&&f()})},[f]),x=u.useCallback(()=>{const h=new RTCPeerConnection({iceServers:cr});return h.ontrack=g=>{m.current&&(m.current.srcObject=g.streams[0])},c.current=h,h},[]),R=u.useCallback(async(h,g)=>{var v;l(null),e("connecting"),s(g);try{const b=await navigator.mediaDevices.getUserMedia({audio:!0});d.current=b;const w=x();b.getTracks().forEach(K=>w.addTrack(K,b)),await w.setRemoteDescription({type:"offer",sdp:g.sdpOffer});const E=await w.createAnswer();await w.setLocalDescription(E),await Ge(w);const z=(v=w.localDescription)==null?void 0:v.sdp;if(!z)throw new Error("No se pudo generar la respuesta SDP.");await sr({companyId:h,leadId:g.leadId,callId:g.id,sdpAnswer:z}),await rr({companyId:h,leadId:g.leadId,callId:g.id}),_(h,g.leadId,g.id),e("in-call")}catch(b){console.error("[useWhatsappCallSession] answer error:",b),l("No se pudo contestar la llamada."),f()}},[f,x,_]),y=u.useCallback(async(h,g)=>{var v;l(null),e("connecting");try{const b=await navigator.mediaDevices.getUserMedia({audio:!0});d.current=b;const w=x();b.getTracks().forEach(Et=>w.addTrack(Et,b));const E=await w.createOffer();await w.setLocalDescription(E),await Ge(w);const z=(v=w.localDescription)==null?void 0:v.sdp;if(!z)throw new Error("No se pudo generar la oferta SDP.");const K=await Ys(h,g.id,z);_(h,g.id,K)}catch(b){console.error("[useWhatsappCallSession] outbound error:",b),l("No se pudo iniciar la llamada."),f()}},[f,x,_]),A=u.useCallback(async(h,g)=>{try{await ar({companyId:h,leadId:g.leadId,callId:g.id})}catch(v){console.error("[useWhatsappCallSession] reject error:",v)}},[]),P=u.useCallback(async()=>{const h=n;if(h)try{await or({companyId:h.companyId,leadId:h.leadId,callId:h.id})}catch(g){console.error("[useWhatsappCallSession] terminate error:",g)}f()},[n,f]),T=u.useCallback(()=>{const h=d.current;if(!h)return;const g=!r;h.getAudioTracks().forEach(v=>{v.enabled=!g}),a(g)},[r]);return{state:t,activeCall:n,error:i,muted:r,remoteAudioRef:m,answerInboundCall:R,rejectInboundCall:A,startOutboundCall:y,hangUp:P,toggleMute:T}}const Tt=u.createContext(null);function ur({children:t}){const e=lr();return o.jsx(Tt.Provider,{value:e,children:t})}function dr(){const t=u.useContext(Tt);if(!t)throw new Error("useCallSession debe usarse dentro de <CallSessionProvider>");return t}function hr(){const{user:t,companyId:e,role:n}=Q(),s=vt(n),r=Ks(e,(t==null?void 0:t.uid)??null,s),a=dr(),[i,l]=u.useState(!1),[c,d]=u.useState(null),[m,p]=u.useState(0),f=a.state==="idle"?r[0]:void 0;if(u.useEffect(()=>{if(a.state!=="in-call"){p(0);return}const A=Date.now(),P=window.setInterval(()=>p(Math.floor((Date.now()-A)/1e3)),1e3);return()=>window.clearInterval(P)},[a.state]),!e)return null;const _=async()=>{if(!(!f||i)){l(!0);try{await a.answerInboundCall(e,f)}finally{l(!1)}}},x=async()=>{if(f){d(f.id);try{await a.rejectInboundCall(e,f)}finally{d(null)}}},R=String(Math.floor(m/60)).padStart(2,"0"),y=String(m%60).padStart(2,"0");return o.jsxs(o.Fragment,{children:[o.jsx("audio",{ref:a.remoteAudioRef,autoPlay:!0}),f&&o.jsxs("div",{className:"fixed inset-x-0 top-4 z-[100] mx-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-emerald-500/30 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur",children:[o.jsx("div",{className:"flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300",children:o.jsx(Ve,{size:18,className:"animate-pulse"})}),o.jsxs("div",{className:"min-w-0 flex-1",children:[o.jsx("p",{className:"truncate text-sm font-medium text-zinc-100",children:f.leadName??se(f.leadPhone??"")}),o.jsx("p",{className:"text-[11px] text-zinc-500",children:"Llamada de WhatsApp entrante"})]}),o.jsx("button",{onClick:x,disabled:c===f.id,title:"Rechazar",className:"flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-50",children:o.jsx(He,{size:16})}),o.jsx("button",{onClick:_,disabled:i,title:"Contestar",className:"flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-50",children:o.jsx(Ve,{size:16})})]}),(a.state==="connecting"||a.state==="in-call")&&a.activeCall&&o.jsxs("div",{className:"fixed inset-x-0 bottom-4 z-[100] mx-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur",children:[o.jsxs("div",{className:"min-w-0 flex-1",children:[o.jsx("p",{className:"truncate text-sm font-medium text-zinc-100",children:a.activeCall.leadName??se(a.activeCall.leadPhone??"")}),o.jsx("p",{className:"text-[11px] text-zinc-500",children:a.state==="connecting"?"Conectando…":`${R}:${y}`})]}),o.jsx("button",{onClick:a.toggleMute,title:a.muted?"Reactivar micrófono":"Silenciar",className:`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${a.muted?"bg-amber-500/20 text-amber-300":"bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`,children:a.muted?o.jsx(Ms,{size:16}):o.jsx(qs,{size:16})}),o.jsx("button",{onClick:a.hangUp,title:"Colgar",className:"flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-400 transition-colors hover:bg-red-500/25",children:o.jsx(He,{size:16})})]}),a.error&&o.jsx("div",{className:"fixed inset-x-0 bottom-20 z-[100] mx-auto w-full max-w-sm rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-xs text-red-300",children:a.error})]})}const fr=U(L,"markLeadRead"),pr=U(L,"markLeadsRead");U(L,"registerPushToken");const Ke=new Set;async function Qr(t,e,n=0){const s=`${t}:${e}:${n}`;if(!Ke.has(s)){Ke.add(s);try{await fr({companyId:t,leadId:e});return}catch(r){console.warn("[Notifications] markLeadRead callable fallo:",r)}}}async function ea(t,e){if(!e.length)return;const n=400;for(let s=0;s<e.length;s+=n)await pr({companyId:t,leadIds:e.slice(s,s+n)})}async function Xe(t){return!t||!("Notification"in window)||!("serviceWorker"in navigator)||Notification.permission!=="granted"||!await Yt()||Object.entries({apiKey:"AIzaSyAKKfQbTz50I4MwdmwVn47P9hVyPsiIp4U",authDomain:"crm-conversacional.firebaseapp.com",projectId:"crm-conversacional",storageBucket:"crm-conversacional.firebasestorage.app",messagingSenderId:"353322694551",appId:"1:353322694551:web:98caaf96ec6130879b76d2"}).filter(([,n])=>!n).map(([n])=>n),!1}function mr(t,e=50,n){const[s,r]=u.useState([]),[a,i]=u.useState(!0),[l,c]=u.useState(null);return u.useEffect(()=>{if(!t){i(!1);return}if((n==null?void 0:n.role)==="advisor"&&!n.uid){r([]),i(!1);return}i(!0),c(null);const d=Jt(ce,"companies",t,"leads"),m=(n==null?void 0:n.role)==="advisor"&&n.uid?me(d,_e("assignedTo","==",n.uid),Se("lastMessageAt","desc"),je(e)):me(d,Se("lastMessageAt","desc"),je(e));return Re(m,f=>{r(f.docs.map(_=>({id:_.id,..._.data()}))),i(!1)},f=>{console.error("[useLeads]",f),c("Error cargando leads."),i(!1)})},[t,e,n==null?void 0:n.role,n==null?void 0:n.uid]),{leads:s,loading:a,error:l}}const Ct="meraki:inbox:readReceipts:v1";function _r(){try{const t=window.localStorage.getItem(Ct);if(!t)return{};const e=JSON.parse(t);return typeof e=="object"&&e!==null?e:{}}catch{return{}}}function gr(t){try{window.localStorage.setItem(Ct,JSON.stringify(t))}catch{}}let V=_r();const xe=new Set;function br(){xe.forEach(t=>t())}function ta(t,e){(V[t]??0)>=e||(V={...V,[t]:e},gr(V),br())}function xr(){const[t,e]=u.useState(V);return u.useEffect(()=>{const n=()=>e(V);return xe.add(n),()=>{xe.delete(n)}},[]),t}function wr(t,e){var s;if(!e||!t.lastInboundAt)return!1;const n=(s=t.readBy)==null?void 0:s[e];return!n||t.lastInboundAt.toMillis()>n.toMillis()}function yr(t,e){return t.filter(n=>wr(n,e)).length}function Ze(t){var e;return((e=t.name)==null?void 0:e.trim())||se(t.phone)}function Rr(t){var e,n;return((n=(e=t.lastInboundAt)==null?void 0:e.toMillis)==null?void 0:n.call(e))??0}function Ye(t){var e,n;return((n=(e=t.createdAt)==null?void 0:e.toMillis)==null?void 0:n.call(e))??0}function vr(){try{const t=window.AudioContext||window.webkitAudioContext;if(!t)return;const e=new t,n=e.createOscillator(),s=e.createGain();n.type="sine",n.frequency.setValueAtTime(740,e.currentTime),n.frequency.exponentialRampToValueAtTime(520,e.currentTime+.16),s.gain.setValueAtTime(1e-4,e.currentTime),s.gain.exponentialRampToValueAtTime(.08,e.currentTime+.02),s.gain.exponentialRampToValueAtTime(1e-4,e.currentTime+.2),n.connect(s),s.connect(e.destination),n.start(),n.stop(e.currentTime+.22),window.setTimeout(()=>e.close().catch(()=>{}),350)}catch{}}function kr(t){if(!("Notification"in window)||Notification.permission!=="granted")return;const e=new Notification(t.title,{body:t.body,icon:"/icon.svg",tag:t.leadId});e.onclick=()=>{window.focus(),window.location.assign(`/dashboard/inbox?lead=${t.leadId}`),e.close()}}function Tr(){const t=Pt(),{companyId:e,user:n}=Q(),{leads:s}=mr(e,500,{uid:(n==null?void 0:n.uid)??null,role:"advisor"}),r=xr(),[a,i]=u.useState(null),[l,c]=u.useState("Notification"in window?Notification.permission:"denied"),d=u.useRef(new Map),m=u.useRef(!1),p=u.useRef(null),f=u.useRef(document.title),_=u.useMemo(()=>n!=null&&n.uid?s.map(h=>{var b,w,E;const g=r[h.id];return!g||(((E=(w=(b=h.readBy)==null?void 0:b[n.uid])==null?void 0:w.toMillis)==null?void 0:E.call(w))??0)>=g?h:{...h,readBy:{...h.readBy??{},[n.uid]:pe.fromMillis(g)}}}):s,[s,r,n==null?void 0:n.uid]),x=u.useMemo(()=>new Map(_.map(h=>[h.id,h])),[_]),R=u.useMemo(()=>yr(_,n==null?void 0:n.uid),[_,n==null?void 0:n.uid]);u.useEffect(()=>()=>{p.current&&window.clearTimeout(p.current),document.title=f.current},[]),u.useEffect(()=>{!e||l!=="granted"||Xe(e).catch(h=>{console.warn("[Notifications] No se pudo registrar push token:",h)})},[e,l]),u.useEffect(()=>{if(R>0){document.title=`(${R}) ${f.current}`;return}document.title=f.current},[R]),u.useEffect(()=>{const h=new Map,g=[];for(const b of _){const w=Rr(b);if(h.set(b.id,w),!m.current||w===0)continue;const E=d.current.get(b.id);if(E===void 0){g.push({id:`${b.id}-${w||Ye(b)}`,leadId:b.id,kind:"new-lead",title:"Nuevo lead asignado",body:`${Ze(b)} entro a tu bandeja.`,createdAt:Math.max(w,Ye(b))});continue}w>E&&g.push({id:`${b.id}-${w}`,leadId:b.id,kind:"new-message",title:"Nuevo mensaje",body:`${Ze(b)}: ${b.lastMessageText??"Mensaje entrante"}`,createdAt:w})}if(d.current=h,!m.current){m.current=!0;return}const v=g.sort((b,w)=>w.createdAt-b.createdAt)[0];v&&(i(v),vr(),kr(v),p.current&&window.clearTimeout(p.current),p.current=window.setTimeout(()=>i(null),7e3))},[_]);const y=h=>{i(null),t(`/dashboard/inbox?lead=${h}`)},A=async()=>{if(!("Notification"in window)||Notification.permission!=="default")return;const h=await Notification.requestPermission();c(h),h==="granted"&&e&&await Xe(e).catch(g=>{console.warn("[Notifications] No se pudo registrar push token:",g)})};if(!a)return null;const P=a.kind==="new-lead"?Hs:Ds,T=x.get(a.leadId);return o.jsx("div",{className:"fixed right-4 top-4 z-[100] w-[min(360px,calc(100vw-2rem))]",children:o.jsxs("div",{className:"overflow-hidden rounded-lg border border-violet-500/30 bg-zinc-950 shadow-2xl shadow-black/40",children:[o.jsxs("button",{type:"button",onClick:()=>y(a.leadId),className:"flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-900",children:[o.jsx("span",{className:"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300",children:o.jsx(P,{className:"h-4 w-4"})}),o.jsxs("span",{className:"min-w-0 flex-1",children:[o.jsx("span",{className:"block text-sm font-semibold text-zinc-100",children:a.title}),o.jsx("span",{className:"mt-0.5 block truncate text-xs text-zinc-400",children:a.body}),(T==null?void 0:T.inboxId)&&o.jsxs("span",{className:"mt-1 block text-[10px] text-zinc-500",children:["Bandeja: ",se(T.inboxId)]})]})]}),o.jsxs("div",{className:"flex items-center justify-between border-t border-zinc-800 px-3 py-2",children:[l==="default"?o.jsx("button",{type:"button",onClick:A,className:"rounded-md px-2 py-1 text-[11px] font-medium text-violet-300 hover:bg-violet-500/10",children:"Permitir notificaciones"}):o.jsxs("span",{className:"text-[11px] text-zinc-500",children:[R," sin leer"]}),o.jsx("button",{type:"button",onClick:()=>i(null),className:"rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200","aria-label":"Cerrar notificacion",children:o.jsx(Gs,{className:"h-4 w-4"})})]})]})})}const Cr=[{to:"/dashboard",icon:"📊",label:"Resumen",end:!0,primary:!0},{to:"/dashboard/inbox",icon:"💬",label:"Bandeja",primary:!0},{to:"/dashboard/leads",icon:"👥",label:"Leads",primary:!0},{to:"/dashboard/calls",icon:"📞",label:"Llamadas IA"},{to:"/dashboard/marketing",icon:"📈",label:"Marketing",adminOnly:!0},{to:"/dashboard/reports",icon:"📄",label:"Informes",adminOnly:!0},{to:"/dashboard/templates",icon:"📋",label:"Plantillas",adminOnly:!0},{to:"/dashboard/broadcasts",icon:"📣",label:"Masivos",adminOnly:!0},{to:"/dashboard/calendar",icon:"📅",label:"Calendario",primary:!0},{to:"/dashboard/config",icon:"⚙️",label:"Config"}];function Er(){const{profile:t,role:e,signOut:n}=Q(),[s,r]=u.useState(!1),a=Cr.filter(c=>!c.adminOnly||vt(e)),i=a.filter(c=>c.primary).slice(0,4),l=a.filter(c=>!i.includes(c));return o.jsx(ur,{children:o.jsxs("div",{className:"flex h-dvh bg-zinc-950 text-zinc-100 overflow-hidden overscroll-none",children:[o.jsxs("aside",{className:"hidden md:flex flex-col w-56 shrink-0 border-r border-zinc-800 bg-zinc-950",children:[o.jsx("div",{className:"px-4 py-4 border-b border-zinc-800",children:o.jsxs("div",{className:"flex items-center gap-2",children:[o.jsx("div",{className:"h-7 w-7 rounded-lg bg-violet-600 flex items-center justify-center text-sm font-bold",children:"M"}),o.jsxs("div",{children:[o.jsx("p",{className:"text-sm font-semibold text-zinc-100 leading-none",children:"Meraki CRM"}),o.jsx("p",{className:"text-[10px] text-zinc-500 mt-0.5",children:"Conversacional"})]})]})}),o.jsx("nav",{className:"flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto",children:a.map(c=>o.jsxs(le,{to:c.to,end:c.end,className:({isActive:d})=>`
                flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                ${d?"bg-violet-600/20 text-violet-300 border border-violet-500/20":"text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"}
              `,children:[o.jsx("span",{children:c.icon}),o.jsx("span",{children:c.label})]},c.to))}),o.jsxs("div",{className:"px-3 py-3 border-t border-zinc-800",children:[o.jsxs("div",{className:"mb-2 px-1",children:[o.jsx("p",{className:"text-xs font-medium text-zinc-300 truncate",children:(t==null?void 0:t.displayName)??(t==null?void 0:t.email)??"—"}),o.jsx("p",{className:"text-[10px] text-zinc-500 truncate",children:(t==null?void 0:t.role)??""})]}),o.jsxs("button",{onClick:n,className:"w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors",children:[o.jsx("span",{children:"🚪"}),o.jsx("span",{children:"Cerrar sesión"})]})]})]}),o.jsx(hr,{}),o.jsx(Tr,{}),o.jsx("main",{className:"flex-1 overflow-hidden pb-14 md:pb-0",children:o.jsx(ye,{})}),o.jsxs("nav",{className:"md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-zinc-800 bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]",children:[i.map(c=>o.jsxs(le,{to:c.to,end:c.end,onClick:()=>r(!1),className:({isActive:d})=>`
              flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors
              ${d?"text-violet-300":"text-zinc-500"}
            `,children:[o.jsx("span",{className:"text-xl leading-none",children:c.icon}),o.jsx("span",{className:"truncate max-w-full px-0.5",children:c.label})]},c.to)),o.jsxs("button",{onClick:()=>r(c=>!c),className:`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${s?"text-violet-300":"text-zinc-500"}`,children:[o.jsx("span",{className:"text-xl leading-none",children:"☰"}),o.jsx("span",{children:"Más"})]})]}),s&&o.jsxs("div",{className:"md:hidden fixed inset-0 z-50",onClick:()=>r(!1),children:[o.jsx("div",{className:"absolute inset-0 bg-black/60 backdrop-blur-sm"}),o.jsxs("div",{className:"absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-zinc-800 bg-zinc-900 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl",onClick:c=>c.stopPropagation(),children:[o.jsx("div",{className:"flex justify-center pt-3 pb-1",children:o.jsx("span",{className:"h-1 w-10 rounded-full bg-zinc-700"})}),o.jsx("div",{className:"flex items-center justify-between px-5 pb-2 pt-1",children:o.jsxs("div",{className:"min-w-0",children:[o.jsx("p",{className:"truncate text-sm font-medium text-zinc-200",children:(t==null?void 0:t.displayName)??(t==null?void 0:t.email)??"—"}),o.jsx("p",{className:"truncate text-[10px] text-zinc-500",children:(t==null?void 0:t.role)??""})]})}),o.jsx("div",{className:"grid grid-cols-3 gap-1 px-3 pb-2",children:l.map(c=>o.jsxs(le,{to:c.to,end:c.end,onClick:()=>r(!1),className:({isActive:d})=>`
                    flex flex-col items-center justify-center gap-1 rounded-xl py-3 text-[11px] font-medium transition-colors
                    ${d?"bg-violet-600/20 text-violet-300":"text-zinc-300 hover:bg-zinc-800/70"}
                  `,children:[o.jsx("span",{className:"text-2xl leading-none",children:c.icon}),o.jsx("span",{className:"truncate max-w-full px-1",children:c.label})]},c.to))}),o.jsx("div",{className:"border-t border-zinc-800 px-3 pt-2",children:o.jsxs("button",{onClick:()=>{r(!1),n()},className:"flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10",children:[o.jsx("span",{children:"🚪"})," Cerrar sesión"]})})]})]})]})})}const Nr=u.lazy(()=>S(()=>import("./LoginPage-1aepWquE.js"),__vite__mapDeps([0,1,2,3])).then(t=>({default:t.LoginPage}))),Ar=u.lazy(()=>S(()=>import("./DashboardPage-BVx0Fn4X.js"),__vite__mapDeps([4,1,3,5,6])).then(t=>({default:t.DashboardPage}))),Pr=u.lazy(()=>S(()=>import("./InboxPage-BrvZbk3I.js"),__vite__mapDeps([7,1,3,8,2,9,10,11,6,5,12,13,14,15])).then(t=>({default:t.InboxPage}))),Ir=u.lazy(()=>S(()=>import("./LeadsPage-DwMlVD7h.js"),__vite__mapDeps([16,1,8,2,9,10,11,6,3,5,12,13,17,18])).then(t=>({default:t.LeadsPage}))),jr=u.lazy(()=>S(()=>import("./ConfigPage-VTYu960p.js"),__vite__mapDeps([19,1,2,3,12,6,13])).then(t=>({default:t.ConfigPage}))),Sr=u.lazy(()=>S(()=>import("./TemplatesPage-qJqjgFYZ.js"),__vite__mapDeps([20,1,2,14,15,3])).then(t=>({default:t.TemplatesPage}))),Or=u.lazy(()=>S(()=>import("./BroadcastsPage-DV8f7P3L.js"),__vite__mapDeps([21,1,2,15,3,17])).then(t=>({default:t.BroadcastsPage}))),Ur=u.lazy(()=>S(()=>import("./CalendarPage-CAhajYKW.js"),__vite__mapDeps([22,1,2,13,3])).then(t=>({default:t.CalendarPage}))),Lr=u.lazy(()=>S(()=>import("./CallsPage-BlF3Xp5a.js"),__vite__mapDeps([23,1,11,6,3])).then(t=>({default:t.CallsPage}))),Dr=u.lazy(()=>S(()=>import("./MarketingPage-C1dLouSk.js"),__vite__mapDeps([24,1,3,9,18,25])).then(t=>({default:t.MarketingPage}))),zr=u.lazy(()=>S(()=>import("./ReportsPage-D43ODXyu.js"),__vite__mapDeps([26,1,3,10,18,25])).then(t=>({default:t.ReportsPage}))),Mr=u.lazy(()=>S(()=>import("./BrandHomePage-CTYmlTm1.js"),__vite__mapDeps([27,1,3])).then(t=>({default:t.BrandHomePage}))),Br=u.lazy(()=>S(()=>import("./PrivacyPolicyPage-B1c3TXO9.js"),__vite__mapDeps([28,1,3])).then(t=>({default:t.PrivacyPolicyPage}))),qr=u.lazy(()=>S(()=>import("./TermsPage-Dw4KtSA2.js"),__vite__mapDeps([29,1,3])).then(t=>({default:t.TermsPage})));function $r(){return o.jsx("div",{className:"flex h-dvh items-center justify-center bg-zinc-950",children:o.jsx(Rt,{})})}function Fr(){return o.jsx(It,{children:o.jsx(ks,{children:o.jsx(u.Suspense,{fallback:o.jsx($r,{}),children:o.jsxs(jt,{children:[o.jsx(N,{path:"/",element:o.jsx(Mr,{})}),o.jsx(N,{path:"/login",element:o.jsx(Nr,{})}),o.jsx(N,{path:"/privacy",element:o.jsx(Br,{})}),o.jsx(N,{path:"/terms",element:o.jsx(qr,{})}),o.jsx(N,{element:o.jsx(Es,{}),children:o.jsxs(N,{element:o.jsx(Er,{}),children:[o.jsx(N,{path:"/dashboard",element:o.jsx(Ar,{})}),o.jsx(N,{path:"/dashboard/inbox",element:o.jsx(Pr,{})}),o.jsx(N,{path:"/dashboard/leads",element:o.jsx(Ir,{})}),o.jsx(N,{path:"/dashboard/calls",element:o.jsx(Lr,{})}),o.jsx(N,{path:"/dashboard/calendar",element:o.jsx(Ur,{})}),o.jsx(N,{path:"/dashboard/config",element:o.jsx(jr,{})}),o.jsxs(N,{element:o.jsx(Ns,{allowed:["admin","manager"]}),children:[o.jsx(N,{path:"/dashboard/marketing",element:o.jsx(Dr,{})}),o.jsx(N,{path:"/dashboard/reports",element:o.jsx(zr,{})}),o.jsx(N,{path:"/dashboard/templates",element:o.jsx(Sr,{})}),o.jsx(N,{path:"/dashboard/broadcasts",element:o.jsx(Or,{})})]})]})}),o.jsx(N,{path:"*",element:o.jsx(we,{to:"/dashboard/inbox",replace:!0})})]})})})})}ge.createRoot(document.getElementById("root")).render(o.jsx(St.StrictMode,{children:o.jsx(Fr,{})}));export{Ds as M,Ve as P,Rt as S,Gs as X,He as a,F as b,yr as c,ce as d,L as e,se as f,Gr as g,wr as h,vt as i,o as j,ea as k,Jr as l,Qr as m,Zr as n,Yr as o,Xr as p,Q as q,Kr as r,ta as s,dr as t,Vr as u,mr as v,xr as w};
