//! Physical key -> label, using the same names the Python agent (pynput)
//! produced so the Keys tab looks the same whichever agent recorded it:
//! letters lowercase, digits and symbols as themselves, and names like
//! "space", "enter", "backspace", "shift", "ctrl", "alt", "cmd".
//! Symbols assume a US layout. A label says which key was pressed, never
//! what text it produced.

#[allow(dead_code)] // each OS build only uses one of the two tables
/// macOS virtual key codes (Carbon HIToolbox/Events.h, ANSI layout).
pub fn mac_label(code: u16) -> Option<&'static str> {
    Some(match code {
        0 => "a", 1 => "s", 2 => "d", 3 => "f", 4 => "h", 5 => "g", 6 => "z", 7 => "x", 8 => "c", 9 => "v",
        11 => "b", 12 => "q", 13 => "w", 14 => "e", 15 => "r", 16 => "y", 17 => "t",
        18 => "1", 19 => "2", 20 => "3", 21 => "4", 22 => "6", 23 => "5", 24 => "=", 25 => "9", 26 => "7",
        27 => "-", 28 => "8", 29 => "0", 30 => "]", 31 => "o", 32 => "u", 33 => "[", 34 => "i", 35 => "p",
        36 => "enter", 37 => "l", 38 => "j", 39 => "'", 40 => "k", 41 => ";", 42 => "\\", 43 => ",",
        44 => "/", 45 => "n", 46 => "m", 47 => ".", 48 => "tab", 49 => "space", 50 => "`",
        51 => "backspace", 53 => "esc",
        54 => "cmd_r", 55 => "cmd", 56 => "shift", 57 => "caps_lock", 58 => "alt", 59 => "ctrl",
        60 => "shift_r", 61 => "alt_r", 62 => "ctrl_r", 63 => "fn",
        65 => ".", 67 => "*", 69 => "+", 71 => "num_lock", 75 => "/", 76 => "enter", 78 => "-", 81 => "=",
        82 => "0", 83 => "1", 84 => "2", 85 => "3", 86 => "4", 87 => "5", 88 => "6", 89 => "7", 91 => "8", 92 => "9",
        96 => "f5", 97 => "f6", 98 => "f7", 99 => "f3", 100 => "f8", 101 => "f9", 103 => "f11",
        105 => "f13", 106 => "f16", 107 => "f14", 109 => "f10", 111 => "f12", 113 => "f15",
        114 => "insert", 115 => "home", 116 => "page_up", 117 => "delete", 118 => "f4", 119 => "end",
        120 => "f2", 121 => "page_down", 122 => "f1",
        123 => "left", 124 => "right", 125 => "down", 126 => "up",
        _ => return None,
    })
}

#[allow(dead_code)]
/// Windows virtual-key codes (winuser.h).
pub fn windows_label(vk: u32) -> Option<String> {
    let s: &str = match vk {
        0x08 => "backspace",
        0x09 => "tab",
        0x0D => "enter",
        0x10 | 0xA0 => "shift",
        0xA1 => "shift_r",
        0x11 | 0xA2 => "ctrl",
        0xA3 => "ctrl_r",
        0x12 | 0xA4 => "alt",
        0xA5 => "alt_r",
        0x14 => "caps_lock",
        0x1B => "esc",
        0x20 => "space",
        0x21 => "page_up",
        0x22 => "page_down",
        0x23 => "end",
        0x24 => "home",
        0x25 => "left",
        0x26 => "up",
        0x27 => "right",
        0x28 => "down",
        0x2D => "insert",
        0x2E => "delete",
        0x5B => "cmd",
        0x5C => "cmd_r",
        0x90 => "num_lock",
        0x91 => "scroll_lock",
        0x6A => "*",
        0x6B => "+",
        0x6D => "-",
        0x6E => ".",
        0x6F => "/",
        0xBA => ";",
        0xBB => "=",
        0xBC => ",",
        0xBD => "-",
        0xBE => ".",
        0xBF => "/",
        0xC0 => "`",
        0xDB => "[",
        0xDC => "\\",
        0xDD => "]",
        0xDE => "'",
        _ => "",
    };
    if !s.is_empty() {
        return Some(s.to_string());
    }
    match vk {
        0x30..=0x39 => Some(((b'0' + (vk - 0x30) as u8) as char).to_string()),
        0x41..=0x5A => Some(((b'a' + (vk - 0x41) as u8) as char).to_string()),
        0x60..=0x69 => Some(((b'0' + (vk - 0x60) as u8) as char).to_string()), // numpad digits
        0x70..=0x87 => Some(format!("f{}", vk - 0x70 + 1)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_codes_map_to_pynput_style_names() {
        assert_eq!(mac_label(0), Some("a"));
        assert_eq!(mac_label(46), Some("m"));
        assert_eq!(mac_label(49), Some("space"));
        assert_eq!(mac_label(51), Some("backspace"));
        assert_eq!(mac_label(36), Some("enter"));
        assert_eq!(mac_label(55), Some("cmd"));
        assert_eq!(mac_label(126), Some("up"));
        assert_eq!(mac_label(122), Some("f1"));
        assert_eq!(mac_label(200), None);
    }

    #[test]
    fn mac_letters_cover_the_alphabet_exactly_once() {
        let mut letters: Vec<&str> = (0u16..128)
            .filter_map(mac_label)
            .filter(|l| l.len() == 1 && l.chars().next().unwrap().is_ascii_lowercase())
            .collect();
        letters.sort();
        let expected: Vec<String> = ('a'..='z').map(|c| c.to_string()).collect();
        assert_eq!(letters, expected.iter().map(String::as_str).collect::<Vec<_>>());
    }

    #[test]
    fn windows_codes_map_to_the_same_names() {
        assert_eq!(windows_label(0x41).as_deref(), Some("a"));
        assert_eq!(windows_label(0x5A).as_deref(), Some("z"));
        assert_eq!(windows_label(0x30).as_deref(), Some("0"));
        assert_eq!(windows_label(0x39).as_deref(), Some("9"));
        assert_eq!(windows_label(0x20).as_deref(), Some("space"));
        assert_eq!(windows_label(0x08).as_deref(), Some("backspace"));
        assert_eq!(windows_label(0x0D).as_deref(), Some("enter"));
        assert_eq!(windows_label(0xA0).as_deref(), Some("shift"));
        assert_eq!(windows_label(0xA3).as_deref(), Some("ctrl_r"));
        assert_eq!(windows_label(0x5B).as_deref(), Some("cmd"));
        assert_eq!(windows_label(0x70).as_deref(), Some("f1"));
        assert_eq!(windows_label(0x87).as_deref(), Some("f24"));
        assert_eq!(windows_label(0x65).as_deref(), Some("5")); // numpad 5
        assert_eq!(windows_label(0xBF).as_deref(), Some("/"));
        assert_eq!(windows_label(0xFF), None);
    }

    #[test]
    fn both_platforms_agree_on_shared_keys() {
        // letters and digits come out identical on both OSes
        let mac_to_vk = [(0u16, 0x41u32), (1, 0x53), (46, 0x4D), (18, 0x31), (29, 0x30), (49, 0x20), (51, 0x08), (53, 0x1B)];
        for (mac, vk) in mac_to_vk {
            assert_eq!(mac_label(mac).map(String::from), windows_label(vk), "mac {mac} vs vk {vk:#x}");
        }
    }
}
