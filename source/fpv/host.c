// host.c: the bridge between libfpv (real Betaflight + SimITL physics, compiled to WebAssembly)
// and the page's JavaScript. Every function here is called from main.js through the
// Emscripten module; structs are flattened into plain arrays so JS never needs C layouts.
// SPDX-License-Identifier: GPL-3.0-or-later
#include <emscripten/emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libfpv.h"

#define API EMSCRIPTEN_KEEPALIVE

static fpv_drone *g_drone;
static fpv_frame g_frame;
static float g_pack[256];
static char g_text[512];

static void on_log(void *user, fpv_log_level level, const char *msg) {
    (void)user;
    if (level >= FPV_LOG_INFO) EM_ASM({ console[$0 >= 2 ? 'warn' : 'log']('[libfpv] ' + UTF8ToString($1)); }, (int)level, msg);
}

API int host_init(const char *build, int no_auto_pause) {
    fpv_global_config cfg;
    fpv_global_config_defaults(&cfg);
    cfg.data_dir = FPV_WEB_DATA_DIR;
    cfg.coords = fpv_coords_preset(FPV_COORDS_Y_UP_RIGHT_HANDED, 1.0f);
    cfg.log = on_log;
    cfg.log_level = FPV_LOG_INFO;
    cfg.flags = FPV_INIT_NO_CONFIGURATOR | FPV_INIT_VIDEO_FEED | (no_auto_pause ? FPV_INIT_NO_AUTO_PAUSE : 0);
    cfg.host_name = "Sodium Sky";
    cfg.host_build = build;
    cfg.host_url = "";
    fpv_result r = fpv_global_init(&cfg);
    if (r != FPV_OK) return -(int)r - 1000;
    g_frame.struct_size = sizeof(fpv_frame);
    return 0;
}
API const char *host_last_error(void) { return fpv_last_error(); }
API const char *host_version(void) { return fpv_version_string(); }

// ---- the world: one static triangle mesh, materials per triangle ----
API int host_materials(void) {
    fpv_material ground = {0.2f, 0.7f, 0}, wall = {0.25f, 0.5f, 0}, water = {0.0f, 0.3f, FPV_MATERIAL_KILLS_PROPS};
    fpv_material glass = {0.2f, 0.4f, FPV_MATERIAL_TRANSPARENT_TO_VIDEO};
    fpv_material_set(0, &ground);
    fpv_material_set(1, &wall);
    fpv_material_set(2, &water);
    fpv_material_set(3, &glass);
    return 0;
}
API int host_load_mesh(const float *positions, uint32_t vertex_count, const uint32_t *indices, uint32_t tri_count,
                       const uint8_t *materials) {
    fpv_mesh m = {0};
    m.positions = positions;
    m.vertex_count = vertex_count;
    m.indices = indices;
    m.triangle_count = tri_count;
    m.materials = materials;
    return (int)fpv_static_surfaces_load(&m, 1);
}
// one piece of the endless city: its triangles (relative to x, y, z) as a surface object that
// stays put; created when the piece comes into range, deleted when it goes. Returns 0 on failure.
API uint32_t host_object_create(const float *positions, uint32_t vertex_count, const uint32_t *indices,
                                uint32_t tri_count, const uint8_t *materials, float x, float y, float z) {
    fpv_mesh m = {0};
    m.positions = positions;
    m.vertex_count = vertex_count;
    m.indices = indices;
    m.triangle_count = tri_count;
    m.materials = materials;
    fpv_transform t = {{x, y, z}, {0, 0, 0, 1}, {1, 1, 1}};
    uint32_t id = 0;
    if (fpv_surface_object_create(&m, &t, &id) != FPV_OK) return 0;
    return id;
}
API int host_object_delete(uint32_t id) { return (int)fpv_surface_object_delete(id); }

// ---- the drone ----
API int host_drone_spawn(float x, float y, float z, float qx, float qy, float qz, float qw) {
    float pos[3] = {x, y, z}, rot[4] = {qx, qy, qz, qw};
    if (!g_drone) {
        fpv_drone_desc d;
        fpv_drone_desc_defaults(&d);
        memcpy(d.position, pos, sizeof pos);
        memcpy(d.rotation, rot, sizeof rot);
        memcpy(d.pilot_position, pos, sizeof pos);
        fpv_result r = fpv_drone_create(&d, &g_drone);
        if (r != FPV_OK) return (int)r;
    } else {
        fpv_drone_reset(g_drone, pos, rot);
        fpv_drone_repair(g_drone);
        fpv_drone_set_pilot_position(g_drone, pos);
    }
    fpv_gps_set_home(pos);
    return 0;
}
API void host_drone_repair(void) { if (g_drone) fpv_drone_repair(g_drone); }
API void host_set_pilot(float x, float y, float z) { float p[3] = {x, y, z}; if (g_drone) fpv_drone_set_pilot_position(g_drone, p); }
API void host_set_view(int v) { fpv_set_view((fpv_view)v); }
API void host_set_paused(int p) { fpv_set_paused(p); }

static int put_cam(int o, const fpv_camera *c) {
    memcpy(g_pack + o, c->position, 12); o += 3;
    memcpy(g_pack + o, c->rotation, 16); o += 4;
    memcpy(g_pack + o, c->forward, 12); o += 3;
    memcpy(g_pack + o, c->up, 12); o += 3;
    memcpy(g_pack + o, c->right, 12); o += 3;
    g_pack[o++] = c->fov_y_degrees;
    g_pack[o++] = c->aspect_hint;
    g_pack[o++] = c->near_plane;
    g_pack[o++] = c->distortion_k1;
    g_pack[o++] = c->distortion_k2;
    g_pack[o++] = c->distortion_zoom;
    return o;  // 22 floats
}

// Advances libfpv by dt and flattens the frame. Layout (float indices) documented in main.js (FR).
API float *host_tick(float dt) {
    if (!g_drone) return 0;
    if (fpv_drone_tick(g_drone, dt, &g_frame) != FPV_OK) return 0;
    const fpv_frame *f = &g_frame;
    int o = 0;
    g_pack[o++] = (float)f->flags;                 // 0
    g_pack[o++] = (float)f->arming_disable_flags;  // 1
    memcpy(g_pack + o, f->position, 12); o += 3;   // 2
    memcpy(g_pack + o, f->rotation, 16); o += 4;   // 5
    memcpy(g_pack + o, f->velocity, 12); o += 3;   // 9
    g_pack[o++] = f->speed_kmh;                    // 12
    g_pack[o++] = f->altitude;                     // 13
    o = put_cam(o, &f->camera);                    // 14..35
    o = put_cam(o, &f->chase_camera);              // 36..57
    o = put_cam(o, &f->los_camera);                // 58..79
    for (int i = 0; i < 4; i++) {                  // 80..119: per motor 10
        const fpv_motor_state *m = &f->motors[i];
        g_pack[o++] = m->rpm; g_pack[o++] = m->thrust_newton; g_pack[o++] = m->current_amp; g_pack[o++] = m->prop_damage;
        memcpy(g_pack + o, m->position, 12); o += 3;
        g_pack[o++] = m->spin_direction; g_pack[o++] = (float)m->flags; g_pack[o++] = m->command;
    }
    g_pack[o++] = f->battery.voltage;              // 120
    g_pack[o++] = f->battery.cell_voltage;
    g_pack[o++] = f->battery.current_amp;
    g_pack[o++] = f->battery.mah_drawn;
    g_pack[o++] = f->battery.capacity_mah;
    g_pack[o++] = (float)f->battery.cell_count;    // 125
    // impacts: count, hardest speed, and whether a prop was hit
    float hard = 0, prop = 0;
    for (uint32_t i = 0; i < f->impact_count && i < FPV_MAX_IMPACTS; i++) {
        if (f->impacts[i].speed > hard) hard = f->impacts[i].speed;
        if (f->impacts[i].motor_index >= 0) prop = 1;
    }
    g_pack[o++] = (float)f->impact_count;          // 126
    g_pack[o++] = hard;                            // 127
    g_pack[o++] = prop;                            // 128
    g_pack[o++] = (float)f->osd_revision;          // 129
    memcpy(g_pack + o, f->wind, 12); o += 3;       // 130
    memcpy(g_pack + o, f->angular_velocity, 12); o += 3;  // 133
    for (int i = 0; i < FPV_CHANNEL_COUNT; i++) g_pack[o++] = f->channels[i];  // 136..145
    // the video feed's scalars (lines come through host_video_lines)
    const fpv_video_feed *v = &f->video_feed;
    o = 150;
    g_pack[o++] = (float)v->flags;                 // 150
    g_pack[o++] = (float)v->system;
    g_pack[o++] = v->picture_aspect;
    g_pack[o++] = (float)v->raster_width;
    g_pack[o++] = (float)v->raster_height;
    g_pack[o++] = v->luma_cycles;                  // 155
    g_pack[o++] = v->chroma_cycles;
    g_pack[o++] = v->subcarrier_cycles;
    g_pack[o++] = v->sharpening;
    g_pack[o++] = (float)v->field;
    g_pack[o++] = (float)v->field_parity;          // 160
    g_pack[o++] = v->roll;
    g_pack[o++] = v->seed;
    memcpy(g_pack + o, v->interference, 16); o += 4;  // 163..166
    g_pack[o++] = v->block_errors;                 // 167
    g_pack[o++] = v->softness;
    g_pack[o++] = (float)v->frozen;
    g_pack[o++] = v->rssi_dbm;                     // 170
    g_pack[o++] = v->cnr_db;
    g_pack[o++] = (float)v->osd_style;
    g_pack[o++] = (float)v->line_count;            // 173
    g_pack[o++] = f->video.noise;                  // 174
    g_pack[o++] = f->video.signal_strength;        // 175
    g_pack[o++] = (float)f->sim_time;              // 176
    return g_pack;
}
API const uint8_t *host_video_lines(void) { return g_frame.video_feed.lines; }
API const char *host_arming_text(void) { return g_frame.arming_disable_text; }

// ---- draw data (overlay and OSD), flattened: vertices, indices and commands in single arrays ----
typedef struct { float clip[4]; float tex, idx_off, idx_count, pad; } flat_cmd;
static fpv_draw_vertex *g_v; static uint32_t *g_i; static flat_cmd *g_c;
static uint32_t g_vcap, g_icap, g_ccap;
static uint32_t g_flat[8];

static const uint32_t *flatten(const fpv_draw_data *dd) {
    memset(g_flat, 0, sizeof g_flat);
    if (!dd) return g_flat;
    uint32_t nv = 0, ni = 0, nc = 0;
    for (uint32_t l = 0; l < dd->list_count; l++) { nv += dd->lists[l].vertex_count; ni += dd->lists[l].index_count; nc += dd->lists[l].command_count; }
    if (nv > g_vcap) { g_vcap = nv * 2; g_v = realloc(g_v, g_vcap * sizeof *g_v); }
    if (ni > g_icap) { g_icap = ni * 2; g_i = realloc(g_i, g_icap * sizeof *g_i); }
    if (nc > g_ccap) { g_ccap = nc * 2 + 8; g_c = realloc(g_c, g_ccap * sizeof *g_c); }
    uint32_t vb = 0, ib = 0, cb = 0;
    for (uint32_t l = 0; l < dd->list_count; l++) {
        const fpv_draw_list *L = &dd->lists[l];
        memcpy(g_v + vb, L->vertices, L->vertex_count * sizeof *g_v);
        for (uint32_t c = 0; c < L->command_count; c++) {
            const fpv_draw_cmd *C = &L->commands[c];
            for (uint32_t k = 0; k < C->index_count; k++) g_i[ib + k] = L->indices[C->index_offset + k] + C->vertex_offset + vb;
            flat_cmd *F = &g_c[cb++];
            memcpy(F->clip, C->clip_rect, 16);
            F->tex = (float)C->texture_id; F->idx_off = (float)ib; F->idx_count = (float)C->index_count; F->pad = 0;
            ib += C->index_count;
        }
        vb += L->vertex_count;
    }
    g_flat[0] = vb; g_flat[1] = ib; g_flat[2] = cb;
    g_flat[3] = (uint32_t)(uintptr_t)g_v; g_flat[4] = (uint32_t)(uintptr_t)g_i; g_flat[5] = (uint32_t)(uintptr_t)g_c;
    return g_flat;
}
API const uint32_t *host_overlay(float dt) { return flatten(fpv_overlay_render(dt)); }
API const uint32_t *host_osd(float w, float h, int style) { return flatten(fpv_osd_draw_data(&g_frame, w, h, (fpv_osd_style)style)); }
static uint32_t g_tex[4];
API const uint32_t *host_texture(int id) {
    fpv_texture t;
    memset(g_tex, 0, sizeof g_tex);
    if (fpv_texture_get((uint64_t)id, &t) == FPV_OK) { g_tex[0] = t.width; g_tex[1] = t.height; g_tex[2] = (uint32_t)(uintptr_t)t.rgba; g_tex[3] = t.revision; }
    return g_tex;
}

// ---- overlay input ----
API void host_overlay_display(float w, float h, float scale) { fpv_overlay_set_display(w, h, scale); }
API void host_overlay_open(int open) { fpv_overlay_set_open(open); }
API int host_overlay_is_open(void) { return fpv_overlay_is_open(); }
API int host_overlay_wants_input(void) { return fpv_overlay_wants_input(); }
API void host_mouse_move(float x, float y) { fpv_overlay_mouse_move(x, y); }
API void host_mouse_button(int b, int down) { fpv_overlay_mouse_button(b, down); }
API void host_mouse_wheel(float dx, float dy) { fpv_overlay_mouse_wheel(dx, dy); }
API void host_text(const char *utf8) { fpv_overlay_text(utf8); }
API void host_key(int key, int down) { fpv_input_key(key, down); }
API void host_set_action(uint32_t id, const char *label) { fpv_overlay_set_action(id, label); }
API uint32_t host_poll_action(void) { return fpv_overlay_poll_action(); }

// ---- input status ----
API const char *host_input_status(void) {
    fpv_input_status s;
    memset(&s, 0, sizeof s);
    s.struct_size = sizeof s;
    fpv_input_get_status(&s);
    // "source|needs_setup|device_count|name"
    snprintf(g_text, sizeof g_text, "%d|%d|%d|%s", (int)s.source, s.needs_setup, s.device_count, s.device_name);
    return g_text;
}

// ---- wind and sim options ----
API void host_wind(float vx, float vz, float turbulence) {
    fpv_wind w;
    fpv_wind_defaults(&w);
    w.velocity[0] = vx; w.velocity[1] = 0; w.velocity[2] = vz;
    w.turbulence = turbulence;
    fpv_wind_set(&w);
}
API void host_sim_options(uint32_t o) { fpv_sim_set_options(o); }
// the FPV camera's angle (degrees, 0..70; < 0 = the quad's own); needs patches/0001-camera-uptilt-api.patch
API void host_camera_uptilt(float d) { fpv_camera_set_uptilt(d); }
API float host_camera_get_uptilt(void) { return fpv_camera_get_uptilt(); }
API uint32_t host_get_sim_options(void) { return fpv_sim_get_options(); }

// ---- sound: the motors and Betaflight's beeper ----
static float *g_audio; static uint32_t g_audio_cap;
API int host_audio_configure(uint32_t rate) { return (int)fpv_audio_configure(rate, 2); }
API float *host_audio(uint32_t frames) {
    if (frames * 2 > g_audio_cap) { g_audio_cap = frames * 2; g_audio = realloc(g_audio, g_audio_cap * sizeof(float)); }
    fpv_audio_read(g_audio, frames);
    return g_audio;
}
API void host_audio_volume(float v) { fpv_audio_set_volume(v); fpv_audio_set_beep_volume(v); }
