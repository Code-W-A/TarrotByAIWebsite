/** @jest-environment jsdom */
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
let mockUser={uid:'alice'};
let mockQuery={ebookId:'demo'};
jest.mock('next/link',()=>({__esModule:true,default:({href,children,...props})=><a href={href} {...props}>{children}</a>}));
jest.mock('next/router',()=>({useRouter:()=>({query:mockQuery,locale:'ro'})}));
jest.mock('../../context/AuthContext',()=>({useAuth:()=>({currentUser:mockUser,loading:false})}));
jest.mock('next-i18next/serverSideTranslations',()=>({serverSideTranslations:jest.fn()}));
jest.mock('../../components/Ebooks/api',()=>({ebookRequest:jest.fn(),ebookText:(_l,ro)=>ro}));
import Reader from '../../pages/ebooks/[ebookId]/read';
import {ebookRequest} from '../../components/Ebooks/api';
let root,container;
const book={title:'Cartea mea',language:'ro',availableLanguages:['ro','en'],chapters:[{_key:'first',title:'Primul'},{_key:'second',title:'Al doilea'}]};
const chapter={title:'Al doilea',body:[{_type:'block',children:[{_type:'span',text:'Conținut'}]}]};
async function render(){await act(async()=>{root.render(<Reader/>)});}
beforeEach(()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();mockUser={uid:'alice'};mockQuery={ebookId:'demo'};jest.clearAllMocks();
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
 ebookRequest.mockImplementation(async(path,_user,options)=>options?.method==='PUT'?{}:path.includes('/progress')?{progress:{chapterId:'second',offset:.5,fontSize:24}}:path.includes('/chapters/')||path.includes('/preview/demo/')?{chapter}:book);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();jest.useRealTimers();});
it('restores chapter, font and scroll, then saves progress to the selected account',async()=>{
 await render();expect(container.textContent).toContain('24 px');expect(ebookRequest).toHaveBeenCalledWith('/demo/chapters/second?locale=ro',mockUser,expect.anything());
 const paper=container.querySelector('[aria-label="Conținutul capitolului"]');
 Object.defineProperties(paper,{scrollHeight:{value:1000},clientHeight:{value:400}});
 await act(async()=>{await jest.advanceTimersByTimeAsync(20)});expect(paper.scrollTop).toBe(300);
 paper.scrollTop=450;await act(async()=>paper.dispatchEvent(new Event('scroll',{bubbles:true})));
 await act(async()=>{await jest.advanceTimersByTimeAsync(2500)});
 const writes=ebookRequest.mock.calls.filter(call=>call[2]?.method==='PUT');
 expect(writes.length).toBeGreaterThan(0);expect(writes[0][1].uid).toBe('alice');expect(JSON.parse(writes[0][2].body)).toEqual({chapterId:'second',offset:.75,fontSize:24});
});
it('continues from the first chapter when progress fails',async()=>{
 ebookRequest.mockImplementation(async(path)=>{if(path.includes('/progress'))throw new Error('Offline');return path.includes('/chapters/')?{chapter}:book});
 await render();expect(container.textContent).toContain('Progresul nu a putut fi încărcat');expect(container.textContent).toContain('18 px');expect(ebookRequest).toHaveBeenCalledWith('/demo/chapters/first?locale=ro',mockUser,expect.anything());
});
it('ignores delayed metadata after switching accounts',async()=>{
 let resolveOld;ebookRequest.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve}));
 await render();mockUser={uid:'bob'};await render();expect(container.textContent).toContain('Cartea mea');
 await act(async()=>resolveOld({...book,title:'Contul anterior'}));expect(container.textContent).not.toContain('Contul anterior');
});
it('never loads or saves account progress in preview',async()=>{
 mockQuery={ebookId:'demo',preview:'1'};await render();await act(async()=>{await jest.advanceTimersByTimeAsync(2600)});
 expect(ebookRequest.mock.calls.some(call=>call[0].includes('/progress'))).toBe(false);
});
