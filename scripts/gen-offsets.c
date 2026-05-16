/* 生成 wasm32 下常用 FreeType 结构体的字段偏移 / 大小 → JSON。
 *
 * 关键：必须用 emcc 编（wasm32 ABI，指针 4 字节），用 node 跑。
 * 绝不能用本机 gcc（x86-64，指针 8 字节）——那样偏移全错。
 *
 * 只覆盖渲染常用结构；JS 侧拿这些 offset 配 getValue 读字段。
 * 没列到的结构，调用方可自行用同样手法扩展。 */
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_GLYPH_H
#include <stddef.h>
#include <stdio.h>

#define O(st, f) printf("    \"" #f "\": %lu,\n", (unsigned long)offsetof(st, f))
#define SZ(st)   printf("  \"sizeof\": %lu,\n", (unsigned long)sizeof(st))

int main(void) {
  printf("{\n");
  printf("\"pointerBytes\": %lu,\n", (unsigned long)sizeof(void *));

  printf("\"FT_FaceRec\": {\n");
  SZ(FT_FaceRec);
  O(FT_FaceRec, num_faces);
  O(FT_FaceRec, num_glyphs);
  O(FT_FaceRec, family_name);
  O(FT_FaceRec, style_name);
  O(FT_FaceRec, num_fixed_sizes);
  O(FT_FaceRec, num_charmaps);
  O(FT_FaceRec, face_flags);
  O(FT_FaceRec, style_flags);
  O(FT_FaceRec, units_per_EM);
  O(FT_FaceRec, ascender);
  O(FT_FaceRec, descender);
  O(FT_FaceRec, height);
  O(FT_FaceRec, max_advance_width);
  O(FT_FaceRec, max_advance_height);
  O(FT_FaceRec, underline_position);
  O(FT_FaceRec, underline_thickness);
  O(FT_FaceRec, glyph);
  O(FT_FaceRec, size);
  O(FT_FaceRec, charmap);
  printf("    \"_end\": 0\n  },\n");

  printf("\"FT_GlyphSlotRec\": {\n");
  SZ(FT_GlyphSlotRec);
  O(FT_GlyphSlotRec, metrics);
  O(FT_GlyphSlotRec, linearHoriAdvance);
  O(FT_GlyphSlotRec, linearVertAdvance);
  O(FT_GlyphSlotRec, advance);
  O(FT_GlyphSlotRec, format);
  O(FT_GlyphSlotRec, bitmap);
  O(FT_GlyphSlotRec, bitmap_left);
  O(FT_GlyphSlotRec, bitmap_top);
  O(FT_GlyphSlotRec, glyph_index);
  printf("    \"_end\": 0\n  },\n");

  printf("\"FT_Glyph_Metrics\": {\n");
  SZ(FT_Glyph_Metrics);
  O(FT_Glyph_Metrics, width);
  O(FT_Glyph_Metrics, height);
  O(FT_Glyph_Metrics, horiBearingX);
  O(FT_Glyph_Metrics, horiBearingY);
  O(FT_Glyph_Metrics, horiAdvance);
  O(FT_Glyph_Metrics, vertBearingX);
  O(FT_Glyph_Metrics, vertBearingY);
  O(FT_Glyph_Metrics, vertAdvance);
  printf("    \"_end\": 0\n  },\n");

  printf("\"FT_Bitmap\": {\n");
  SZ(FT_Bitmap);
  O(FT_Bitmap, rows);
  O(FT_Bitmap, width);
  O(FT_Bitmap, pitch);
  O(FT_Bitmap, buffer);
  O(FT_Bitmap, num_grays);
  O(FT_Bitmap, pixel_mode);
  printf("    \"_end\": 0\n  },\n");

  printf("\"FT_Size_Metrics\": {\n");
  SZ(FT_Size_Metrics);
  O(FT_Size_Metrics, x_ppem);
  O(FT_Size_Metrics, y_ppem);
  O(FT_Size_Metrics, x_scale);
  O(FT_Size_Metrics, y_scale);
  O(FT_Size_Metrics, ascender);
  O(FT_Size_Metrics, descender);
  O(FT_Size_Metrics, height);
  O(FT_Size_Metrics, max_advance);
  printf("    \"_end\": 0\n  },\n");

  printf("\"FT_SizeRec\": {\n");
  SZ(FT_SizeRec);
  O(FT_SizeRec, metrics);
  printf("    \"_end\": 0\n  },\n");

  printf("\"FT_Vector\": {\n");
  SZ(FT_Vector);
  O(FT_Vector, x);
  O(FT_Vector, y);
  printf("    \"_end\": 0\n  },\n");

  printf("\"FT_CharMapRec\": {\n");
  SZ(FT_CharMapRec);
  O(FT_CharMapRec, face);
  O(FT_CharMapRec, encoding);
  O(FT_CharMapRec, platform_id);
  O(FT_CharMapRec, encoding_id);
  printf("    \"_end\": 0\n  }\n");

  printf("}\n");
  return 0;
}
