"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InteractionSystem = void 0;
const THREE = __importStar(require("three"));
const KEY = '__ix';
class InteractionSystem {
    constructor(reach = 2.4) {
        this.current = null;
        this.targets = [];
        this.occluders = [];
        this.all = [];
        this.dirty = true;
        this.ray = new THREE.Raycaster();
        this.ndc = new THREE.Vector2(0, 0); // tengah layar = posisi crosshair
        this.frame = 0;
        this.lastPos = new THREE.Vector3();
        this.lastQuat = new THREE.Quaternion();
        this.tmpPos = new THREE.Vector3();
        this.tmpQuat = new THREE.Quaternion();
        this.idle = 0;
        this.hasLast = false;
        this.reach = reach;
    }
    register(it, objects) {
        for (const o of objects)
            o.traverse((m) => { if (m.isMesh) {
                m.userData[KEY] = it;
                this.targets.push(m);
            } });
        this.dirty = true;
    }
    unregister(it) {
        this.targets = this.targets.filter((m) => m.userData[KEY] !== it);
        if (this.current?.it === it)
            this.current = null;
        this.dirty = true;
    }
    removeWhere(pred) {
        this.targets = this.targets.filter((m) => { const it = m.userData[KEY]; return !(it && pred(it)); });
        if (this.current && pred(this.current.it))
            this.current = null;
        this.dirty = true;
    }
    addOccluders(objs) { for (const o of objs)
        o.traverse((m) => { if (m.isMesh && !m.userData[KEY])
            this.occluders.push(m); }); this.dirty = true; }
    removeOccluders(objs) {
        const set = new Set();
        for (const o of objs)
            o.traverse((m) => set.add(m));
        this.occluders = this.occluders.filter((m) => !set.has(m));
        this.dirty = true;
    }
    visibleChain(o) { while (o) {
        if (!o.visible)
            return false;
        o = o.parent;
    } return true; }
    inside(o, root) { for (let p = o; p; p = p.parent)
        if (p === root)
            return true; return false; }
    /** Panggil tiap frame. Raycast dibatasi ~20 Hz, dan dilewati bila kamera diam (hanya dicek ulang tiap ~0.3 dtk) agar ringan di HP. */
    update(cam, ctx, every = 3) {
        const force = every === 1;
        if (!force) {
            if ((this.frame++ % every) !== 0) { // frame di antara dua raycast: pakai hasil terakhir
                if (this.current && this.current.it.prompt(ctx) === null)
                    this.current = null;
                return this.current;
            }
            cam.getWorldPosition(this.tmpPos);
            cam.getWorldQuaternion(this.tmpQuat);
            const same = this.hasLast && this.tmpPos.distanceToSquared(this.lastPos) < 1e-6 && this.tmpQuat.angleTo(this.lastQuat) < 1e-4 && !this.dirty;
            if (same && ++this.idle < 6) {
                if (this.current && this.current.it.prompt(ctx) === null)
                    this.current = null;
                return this.current;
            }
            this.idle = 0;
            this.lastPos.copy(this.tmpPos);
            this.lastQuat.copy(this.tmpQuat);
            this.hasLast = true;
        }
        if (this.dirty) {
            this.all = this.targets.concat(this.occluders);
            this.dirty = false;
        }
        this.ray.setFromCamera(this.ndc, cam);
        this.ray.far = this.reach + 0.5;
        const hits = this.ray.intersectObjects(this.all, false);
        // key yang terlihat & dalam jangkauan: furniture pemiliknya tidak boleh menghalangi bidikan
        const shelters = [];
        for (const h of hits) {
            const it = h.object.userData[KEY];
            if (it && it.kind === 'key' && it.shelter && this.visibleChain(h.object) && h.distance <= (it.reach ?? this.reach) && it.prompt(ctx) !== null)
                shelters.push(it.shelter);
        }
        this.current = null;
        let cand = null;
        for (const h of hits) {
            if (!this.visibleChain(h.object))
                continue;
            const it = h.object.userData[KEY];
            if (!it) { // objek biasa: penghalang, kecuali bagian dari furniture pemilik key yang sedang dibidik
                if (shelters.length && shelters.some((r) => this.inside(h.object, r)))
                    continue;
                break;
            }
            if (h.distance > (it.reach ?? this.reach)) {
                if (it.kind === 'key')
                    continue;
                break;
            }
            // prompt null = objek 'tembus' bagi crosshair -> lanjut ke objek di belakangnya
            if (it.prompt(ctx) === null)
                continue;
            if (it.kind === 'key') {
                cand = { it, dist: h.distance, object: h.object, point: h.point };
                break;
            } // key diprioritaskan
            if (!cand)
                cand = { it, dist: h.distance, object: h.object, point: h.point };
        }
        this.current = cand;
        return this.current;
    }
    /** Raycast ulang segera (dipanggil saat tombol interaksi ditekan, agar target selalu terbaru). */
    refresh(cam, ctx) { return this.update(cam, ctx, 1); }
    prompt(ctx) { return this.current ? this.current.it.prompt(ctx) : null; }
    /** Tekan tombol interaksi: jalankan target di bawah crosshair. */
    activate(ctx) {
        if (!this.current)
            return false;
        this.current.it.interact(ctx);
        return true;
    }
    /** Paksa raycast ulang pada pemanggilan update berikutnya (state dunia berubah: container terbuka, pintu bergerak, dll). */
    invalidate() { this.hasLast = false; }
    clear() { this.targets = []; this.occluders = []; this.all = []; this.current = null; this.dirty = true; this.hasLast = false; }
}
exports.InteractionSystem = InteractionSystem;
