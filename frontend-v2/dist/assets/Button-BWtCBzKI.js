import{j as t,S as d}from"./index-7JHraqy8.js";const c={primary:"bg-violet-600 hover:bg-violet-500 text-white",secondary:"bg-zinc-700 hover:bg-zinc-600 text-zinc-100",ghost:"bg-transparent hover:bg-zinc-800 text-zinc-300",danger:"bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30"},x={sm:"px-3 py-1.5 text-xs",md:"px-4 py-2   text-sm",lg:"px-5 py-2.5 text-base"};function b({variant:r="primary",size:s="md",loading:e=!1,disabled:n,children:o,className:i="",...a}){return t.jsxs("button",{...a,disabled:n||e,className:`
        inline-flex items-center justify-center gap-2 rounded-lg font-medium
        transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500/50
        disabled:opacity-50 disabled:cursor-not-allowed
        ${c[r]} ${x[s]} ${i}
      `,children:[e&&t.jsx(d,{size:"sm"}),o]})}export{b as B};
