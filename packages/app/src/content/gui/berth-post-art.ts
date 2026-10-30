/// <reference types="vite/client" />
import { Texture } from 'pixi.js';
import postUrl from '../../assets/markers/berth-post.png';
import { loadTextureIfPresent } from '../net.js';

/** The dock cursor's mooring post, or undefined when its page fails to load and the renderer's stand-in
 *  draws. */
export async function loadBerthPostArt(): Promise<Texture | undefined> {
  const post = await loadTextureIfPresent(postUrl);
  return post === undefined ? undefined : new Texture({ source: post });
}
