// Correspondencia por defecto: id de color de Rebrickable -> id de color LEGO (el que usa Pick a Brick).
// Si un color no está aquí, la app te deja asignarlo a mano y lo guarda en la tabla rb_color_map,
// que tiene prioridad sobre esta lista.
export const DEFAULT_RB_TO_LEGO = {
  0: '26',    // Black
  1: '23',    // Blue -> Bright Blue
  2: '28',    // Green -> Dark Green
  3: '107',   // Dark Turquoise -> Bright Bluish Green
  4: '21',    // Red -> Bright Red
  5: '221',   // Dark Pink -> Bright Purple
  6: '25',    // Brown (antiguo)
  7: '2',     // Light Gray (antiguo)
  8: '27',    // Dark Gray (antiguo)
  9: '45',    // Light Blue
  10: '37',   // Bright Green
  11: '116',  // Light Turquoise
  13: '9',    // Pink
  14: '24',   // Yellow -> Bright Yellow
  15: '1',    // White
  17: '6',    // Light Green
  18: '3',    // Light Yellow
  19: '5',    // Tan -> Brick Yellow
  22: '104',  // Purple
  25: '106',  // Orange -> Bright Orange
  26: '124',  // Magenta -> Bright Reddish Violet
  27: '119',  // Lime -> Bright Yellowish Green
  28: '138',  // Dark Tan -> Sand Yellow
  29: '222',  // Bright Pink -> Light Purple
  30: '324',  // Medium Lavender
  31: '325',  // Lavender
  33: '43',   // Trans-Dark Blue -> Tr. Blue
  34: '48',   // Trans-Green
  35: '311',  // Trans-Bright Green
  36: '41',   // Trans-Red
  40: '111',  // Trans-Black -> Tr. Brown
  41: '42',   // Trans-Light Blue
  42: '49',   // Trans-Neon Green
  43: '143',  // Trans-Very Lt Blue
  45: '113',  // Trans-Dark Pink
  46: '44',   // Trans-Yellow
  47: '40',   // Trans-Clear -> Transparent
  52: '126',  // Trans-Purple
  57: '47',   // Trans-Neon Orange
  70: '192',  // Reddish Brown
  71: '194',  // Light Bluish Gray -> Medium Stone Grey
  72: '199',  // Dark Bluish Gray -> Dark Stone Grey
  73: '102',  // Medium Blue
  74: '29',   // Medium Green
  78: '283',  // Light Nougat
  84: '312',  // Medium Nougat
  85: '268',  // Dark Purple -> Medium Lilac
  92: '18',   // Nougat
  179: '315', // Flat Silver -> Silver Metallic
  182: '182', // Trans-Orange
  191: '191', // Bright Light Orange -> Flame Yellowish Orange
  212: '212', // Bright Light Blue -> Light Royal Blue
  216: '216', // Rust
  226: '226', // Bright Light Yellow -> Cool Yellow
  272: '140', // Dark Blue -> Earth Blue
  288: '141', // Dark Green -> Earth Green
  297: '297', // Pearl Gold -> Warm Gold
  308: '308', // Dark Brown
  320: '154', // Dark Red -> New Dark Red
  321: '321', // Dark Azure
  322: '322', // Medium Azure
  323: '323', // Light Aqua -> Aqua
  326: '326', // Yellowish Green -> Spring Yellowish Green
  330: '330', // Olive Green
  378: '151', // Sand Green
  379: '135', // Sand Blue
  484: '38',  // Dark Orange
};
