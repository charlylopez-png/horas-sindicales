// ============================================================
//  CONFIGURACIÓN — único archivo que hay que tocar al desplegar
// ============================================================

// Pega aquí el bloque firebaseConfig de tu proyecto Firebase
// (Consola Firebase → Configuración del proyecto → Tus apps → Web).
// Mientras apiKey empiece por "PEGAR", la app arranca en MODO DEMO
// (datos solo en este navegador, para probar).
export const firebaseConfig = {
  apiKey: "AIzaSyBpNRRjcFDG7UO5aK5KB-THYqwsGbAhdFQ",
  authDomain: "horas-sindicales-cf166.firebaseapp.com",
  projectId: "horas-sindicales-cf166",
  storageBucket: "horas-sindicales-cf166.firebasestorage.app",
  messagingSenderId: "135059790244",
  appId: "1:135059790244:web:f19c40e6f60c1cb3b44931"
};

// Correos que son administradores desde el primer registro.
// (Si lo cambias, cámbialo también en firestore.rules)
export const ADMIN_EMAILS = ["charly.lopez@gmail.com"];

// Horas sindicales mensuales por defecto de cada miembro del comité
export const CUOTA_MENSUAL = 20;

// Avisar cuando a alguien le queden estas horas o menos
export const AVISO_HORAS = 4;

// Miembros del comité que se crean la primera vez que entra un administrador
export const TRABAJADORES_INICIALES = [
  "JOSÉ ANTONIO NÚÑEZ",
  "CÉSAR DE CAMPOS",
  "DANIEL RODRÍGUEZ",
  "ERNESTO ALCÁZAR",
  "ALEJANDRO CALERO",
  "ALFONSO BERZAL",
  "MABEL LACASA",
  "DANIEL LOMBA",
  "JAVIER MESA"
];
