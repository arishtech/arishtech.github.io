!function(e,n){"object"==typeof exports&&"object"==typeof module?module.exports=n(require("react")):"function"==typeof define&&define.amd?define("rb_wixui.thunderbolt[MenuContainer_Responsive]",["react"],n):"object"==typeof exports?exports["rb_wixui.thunderbolt[MenuContainer_Responsive]"]=n(require("react")):e["rb_wixui.thunderbolt[MenuContainer_Responsive]"]=n(e.React)}("undefined"!=typeof self?self:this,(function(e){return function(){var n={40841:function(e,n){var t;
/*!
	Copyright (c) 2018 Jed Watson.
	Licensed under the MIT License (MIT), see
	http://jedwatson.github.io/classnames
*/!function(){"use strict";var r={}.hasOwnProperty;function o(){for(var e=[],n=0;n<arguments.length;n++){var t=arguments[n];if(t){var a=typeof t;if("string"===a||"number"===a)e.push(t);else if(Array.isArray(t)){if(t.length){var i=o.apply(null,t);i&&e.push(i)}}else if("object"===a){if(t.toString!==Object.prototype.toString&&!t.toString.toString().includes("[native code]")){e.push(t.toString());continue}for(var s in t)r.call(t,s)&&t[s]&&e.push(s)}}}return e.join(" ")}e.exports?(o.default=o,e.exports=o):void 0===(t=function(){return o}.apply(n,[]))||(e.exports=t)}()},5329:function(n){"use strict";n.exports=e},448:function(e){function n(){return e.exports=n=Object.assign?Object.assign.bind():function(e){for(var n=1;n<arguments.length;n++){var t=arguments[n];for(var r in t)Object.prototype.hasOwnProperty.call(t,r)&&(e[r]=t[r])}return e},e.exports.__esModule=!0,e.exports.default=e.exports,n.apply(this,arguments)}e.exports=n,e.exports.__esModule=!0,e.exports.default=e.exports}},t={};function r(e){var o=t[e];if(void 0!==o)return o.exports;var a=t[e]={exports:{}};return n[e](a,a.exports,r),a.exports}r.n=function(e){var n=e&&e.__esModule?function(){return e.default}:function(){return e};return r.d(n,{a:n}),n},r.d=function(e,n){for(var t in n)r.o(n,t)&&!r.o(e,t)&&Object.defineProperty(e,t,{enumerable:!0,get:n[t]})},r.o=function(e,n){return Object.prototype.hasOwnProperty.call(e,n)},r.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})};var o={};return function(){"use strict";r.r(o),r.d(o,{components:function(){return h}});var e=r(5329),n=r.n(e),t=r(40841),a=r.n(t),i={menuContainer:"KLO7MJ",visible:"a6BVa5",inlineContent:"vyb81L",container:"qNR7mP",overlay:"oOL4sX",horizontallyDocked:"AESkWR",verticallyDocked:"I2F1wm",inlineContentParent:"asChkN",open:"nIzsA4"},s=r(448),l=r.n(s);const c="responsive-container-overflow",u="responsive-container-content",p=e=>{let t=e.children,r=e.className;return n().createElement("div",{className:r,tabIndex:0,"data-testid":c},t)};var d=t=>{let r=t.containerLayoutClassName,o=t.overlowWrapperClassName,i=t.hasOverflow,s=t.shouldOmitWrapperLayers,c=t.children,d=t.role,f=t.extraRootClass,v=void 0===f?"":f;return(0,e.useCallback)((e=>!s&&i?n().createElement(p,{className:a()(o,v)},e):e),[v,i,o,s])(s?n().createElement(n().Fragment,null,c()):n().createElement("div",l()({className:i?r:a()(r,v),"data-testid":u},d?{role:d}:{}),c()))},f="UjpP2K",v="SaGcIp",m="naw_Hj",y="RcfHS8",b="AVLx_K";var x=e=>{let t=e.classNames,r=e.layerIds,o=e.containerProps,i=e.children;return n().createElement(n().Fragment,null,n().createElement("div",{id:r.overlay,className:a()(v,{[m]:t.includes("horizontallyDocked")})}),n().createElement("div",{id:r.container,className:a()(f)},n().createElement("div",{className:""+b}),n().createElement("div",{id:r.inlineContentParent,className:y},n().createElement(d,l()({},o,{extraRootClass:y}),i))))};const h={MenuContainer_Responsive:{component:n=>{let t=n.id,r=n.isOpen,o=n.isVisible,s=n.children,l=n.classNames,c=n.containerProps,u=n.onClick,p=n.onMouseEnter,d=n.onMouseLeave;r&&!o&&(o=!0);const f={overlay:"overlay-"+t,container:"container-"+t,inlineContentParent:"inlineContentParent-"+t};return e.createElement("div",{id:t,tabIndex:0,onClick:u,onMouseEnter:p,onMouseLeave:d,className:a()(i.menuContainer,l.map((e=>i[e])),{[i.visible]:o,[i.open]:r})},e.createElement(x,{containerProps:c,id:t,layerIds:f,classNames:l},s))}}}}(),o}()}));
//# sourceMappingURL=https://static.parastorage.com/services/editor-elements-library/dist/thunderbolt/rb_wixui.thunderbolt[MenuContainer_Responsive].5dffbb19.bundle.min.js.map