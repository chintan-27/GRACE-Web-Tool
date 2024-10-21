#include <iostream>
#include <cstring>
#include <cmath>
#include <emscripten/bind.h>

// Trilinear interpolation function
float trilinear_interpolation(float x, float y, float z, 
                              unsigned char* data, 
                              int original_width, int original_height, int original_depth) {
    int x0 = static_cast<int>(std::floor(x));
    int y0 = static_cast<int>(std::floor(y));
    int z0 = static_cast<int>(std::floor(z));
    
    int x1 = (x0 + 1 < original_width) ? x0 + 1 : x0;
    int y1 = (y0 + 1 < original_height) ? y0 + 1 : y0;
    int z1 = (z0 + 1 < original_depth) ? z0 + 1 : z0;
    
    float dx = x - x0;
    float dy = y - y0;
    float dz = z - z0;
    
    float c000 = data[(z0 * original_height * original_width) + (y0 * original_width) + x0];
    float c001 = data[(z1 * original_height * original_width) + (y0 * original_width) + x0];
    float c010 = data[(z0 * original_height * original_width) + (y1 * original_width) + x0];
    float c011 = data[(z1 * original_height * original_width) + (y1 * original_width) + x0];
    float c100 = data[(z0 * original_height * original_width) + (y0 * original_width) + x1];
    float c101 = data[(z1 * original_height * original_width) + (y0 * original_width) + x1];
    float c110 = data[(z0 * original_height * original_width) + (y1 * original_width) + x1];
    float c111 = data[(z1 * original_height * original_width) + (y1 * original_width) + x1];

    float c00 = c000 * (1 - dx) + c100 * dx;
    float c01 = c001 * (1 - dx) + c101 * dx;
    float c10 = c010 * (1 - dx) + c110 * dx;
    float c11 = c011 * (1 - dx) + c111 * dx;

    float c0 = c00 * (1 - dy) + c10 * dy;
    float c1 = c01 * (1 - dy) + c11 * dy;

    return c0 * (1 - dz) + c1 * dz;
}

// Function to resize NIfTI data
void resize_nifti(unsigned char* input_data, int original_width, int original_height, int original_depth,
                  unsigned char* output_data, int new_width, int new_height, int new_depth) {

    memset(output_data, 0, new_width * new_height * new_depth);

    float scale_x = static_cast<float>(original_width) / new_width;
    float scale_y = static_cast<float>(original_height) / new_height;
    float scale_z = static_cast<float>(original_depth) / new_depth;

    for (int z = 0; z < new_depth; ++z) {
      for (int y = 0; y < new_height; ++y) {
        for (int x = 0; x < new_width; ++x) {
          float orig_x = x * scale_x;
          float orig_y = y * scale_y;
          float orig_z = z * scale_z;

          output_data[(z * new_height * new_width) + (y * new_width) + x] = static_cast<unsigned char>(
            trilinear_interpolation(orig_x, orig_y, orig_z, input_data, original_width, original_height, original_depth)
          );
        }
      }
    }
}

// EMSCRIPTEN Bindings
EMSCRIPTEN_BINDINGS(my_module) {
    emscripten::function("resize_nifti", &resize_nifti, emscripten::allow_raw_pointers());
    emscripten::function("trilinear_interpolation", &trilinear_interpolation, emscripten::allow_raw_pointers());
}
