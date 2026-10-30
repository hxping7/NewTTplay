#include <windows.h>
#include <stdio.h>
#include "ttp_lrcsh_new.c"
int main(void) {
    FILE *out = fopen("test_tag_out.txt", "wb");
    const wchar_t *paths[] = {
        L"D:/Music/示例专辑/136. 兒歌.wav",
        L"D:/Music/示例专辑/151. 她.wav",
        NULL };
    for (int i = 0; paths[i]; i++) {
        char a[160] = "", t[256] = "";
        int ok = read_tag_from_file_w(paths[i], a, sizeof(a), t, sizeof(t));
        fprintf(out, "ok=%d artist=<%s> title=<%s>\n", ok, a, t);
    }
    fclose(out);
    return 0;
}
