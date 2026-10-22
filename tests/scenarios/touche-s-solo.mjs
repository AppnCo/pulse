// S = solo / désolo de la piste choisie
export default async ({ ev, nav, send, sleep }) => {
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await nav('http://localhost:8765/studio.html'); await sleep(2500);
  const press = (k, code, extra='') => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',code:'${code}',bubbles:true,cancelable:true${extra}})); 0`);
  await ev(`state.selectedTrack=0; state.project.tracks[0].solo=false; 0`);
  await press('s','KeyS'); console.log('S → solo:', await ev(`state.project.tracks[0].solo`));
  await press('s','KeyS'); console.log('S encore → désolo:', await ev(`state.project.tracks[0].solo`));
  await press('s','KeyS', ',metaKey:true'); console.log('⌘S ne touche pas au solo:', await ev(`state.project.tracks[0].solo`));
};
