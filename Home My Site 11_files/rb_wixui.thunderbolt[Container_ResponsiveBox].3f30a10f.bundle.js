!function(e,r){"object"==typeof exports&&"object"==typeof module?module.exports=r(require("react")):"function"==typeof define&&define.amd?define("rb_wixui.thunderbolt[Container_ResponsiveBox]",["react"],r):"object"==typeof exports?exports["rb_wixui.thunderbolt[Container_ResponsiveBox]"]=r(require("react")):e["rb_wixui.thunderbolt[Container_ResponsiveBox]"]=r(e.React)}("undefined"!=typeof self?self:this,(function(e){return function(){var r={40841:function(e,r){var t;
/*!
	Copyright (c) 2018 Jed Watson.
	Licensed under the MIT License (MIT), see
	http://jedwatson.github.io/classnames
*/!function(){"use strict";var n={}.hasOwnProperty;function o(){for(var e=[],r=0;r<arguments.length;r++){var t=arguments[r];if(t){var a=typeof t;if("string"===a||"number"===a)e.push(t);else if(Array.isArray(t)){if(t.length){var i=o.apply(null,t);i&&e.push(i)}}else if("object"===a){if(t.toString!==Object.prototype.toString&&!t.toString.toString().includes("[native code]")){e.push(t.toString());continue}for(var s in t)n.call(t,s)&&t[s]&&e.push(s)}}}return e.join(" ")}e.exports?(o.default=o,e.exports=o):void 0===(t=function(){return o}.apply(r,[]))||(e.exports=t)}()},5329:function(r){"use strict";r.exports=e},448:function(e){function r(){return e.exports=r=Object.assign?Object.assign.bind():function(e){for(var r=1;r<arguments.length;r++){var t=arguments[r];for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n])}return e},e.exports.__esModule=!0,e.exports.default=e.exports,r.apply(this,arguments)}e.exports=r,e.exports.__esModule=!0,e.exports.default=e.exports},66820:function(e){e.exports=function(e,r){if(null==e)return{};var t,n,o={},a=Object.keys(e);for(n=0;n<a.length;n++)t=a[n],r.indexOf(t)>=0||(o[t]=e[t]);return o},e.exports.__esModule=!0,e.exports.default=e.exports}},t={};function n(e){var o=t[e];if(void 0!==o)return o.exports;var a=t[e]={exports:{}};return r[e](a,a.exports,n),a.exports}n.n=function(e){var r=e&&e.__esModule?function(){return e.default}:function(){return e};return n.d(r,{a:r}),r},n.d=function(e,r){for(var t in r)n.o(r,t)&&!n.o(e,t)&&Object.defineProperty(e,t,{enumerable:!0,get:r[t]})},n.o=function(e,r){return Object.prototype.hasOwnProperty.call(e,r)},n.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})};var o={};return function(){"use strict";n.r(o),n.d(o,{components:function(){return h}});var e=n(448),r=n.n(e),t=n(66820),a=n.n(t),i=n(5329),s=n(40841),l=n.n(s),u="nDEeB0";const c="Interactive element, focus to trigger content change",p=["pressed","expanded","haspopup","label","live","relevant","current","owns","controls","roleDescription","hidden","disabled","describedBy","labelledBy","errorMessage","atomic","role","busy"],d=13,f=27;function b(e){return r=>{r.keyCode===e&&(r.preventDefault(),r.stopPropagation(),r.currentTarget.click())}}b(32),b(d),b(f);var v="Z5xE6X",y="OSxohk";const x=["aria-label-interactions"],g=(e,t)=>{const n=e.id,o=e.className,s=e.containerRootClassName,d=void 0===s?"":s,f=e.children,b=e.role,g=e.onClick,h=e.onDblClick,m=e.onFocus,_=e.onBlur,O=e.onMouseEnter,j=e.onMouseLeave,M=e.hasPlatformClickHandler,B=e.translate,C=e.a11y,S=void 0===C?{}:C,w=e.ariaAttributes,k=void 0===w?{}:w,P=e.tabIndex,R=S["aria-label-interactions"],D=a()(S,x);R&&(D["aria-label"]=(e=>e?e("ariaLabels","interactions_AriaLabel_contentOnHover_message",c):c)(B));const E=i.useRef(null);return i.useImperativeHandle(t,(()=>({focus:()=>{var e;null==(e=E.current)||e.focus()},blur:()=>{var e;null==(e=E.current)||e.blur()}}))),i.createElement("div",r()({id:n},(e=>Object.entries(e).reduce(((e,r)=>{let t=r[0],n=r[1];return t.includes("data-")&&(e[t]=n),e}),{}))(e),{ref:E},D,function(e){var r;void 0===e&&(e={});let t=e,n=t.pressed,o=t.expanded,i=t.haspopup,s=t.label,l=t.live,u=t.relevant,c=t.current,d=t.owns,f=t.controls,b=t.roleDescription,v=t.hidden,y=t.disabled,x=t.describedBy,g=t.labelledBy,h=t.errorMessage,m=t.atomic,_=t.role,O=t.busy,j=a()(t,p);const M=null!=(r=j.tabIndex)?r:j.tabindex,B={};return s&&(B["aria-label"]=s),l&&(B["aria-live"]=l),c&&(B["aria-current"]=c),n&&(B["aria-pressed"]=n),"boolean"==typeof v&&(B["aria-hidden"]=v),"boolean"==typeof o&&(B["aria-expanded"]=o),"boolean"==typeof y&&(B["aria-disabled"]=y),"boolean"==typeof m&&(B["aria-atomic"]=m),"boolean"==typeof O&&(B["aria-busy"]=O),"string"==typeof u&&(B["aria-relevant"]=u),"string"==typeof d&&(B["aria-owns"]=d),"string"==typeof f&&(B["aria-controls"]=f),"string"==typeof b&&(B["aria-roledescription"]=b),i&&(B["aria-haspopup"]=i),"number"==typeof M&&(B.tabIndex=M),_&&(B.role=_),x&&(B["aria-describedby"]=x),g&&(B["aria-labelledby"]=g),h&&(B["aria-errormessage"]=h),B}(r()({},k,{tabIndex:P,role:b})),{className:l()(o,v,d,{[u]:M}),onDoubleClick:h,onClick:g,onFocus:m,onBlur:_,onMouseEnter:O,onMouseLeave:j}),i.createElement("div",{className:y}),f())};const h={Container_ResponsiveBox:{component:i.forwardRef(g)}}}(),o}()}));
//# sourceMappingURL=https://static.parastorage.com/services/editor-elements-library/dist/thunderbolt/rb_wixui.thunderbolt[Container_ResponsiveBox].3f30a10f.bundle.min.js.map