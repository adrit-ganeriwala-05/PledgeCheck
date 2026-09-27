// Patient-facing copy for the redesigned capture flow, in both languages. Calm, plain and
// second person. Never mentions results, readers or fraud checks: the app verifies, the
// doctor decides.
import type { SignInCopy } from "@/components/portal/patient-sign-in-form";
import type { Language } from "@/lib/voice";

export const STEP_COUNT = 4;

type Copy = {
  welcomeTitle: string;
  welcomeBody: string;
  privacy: string;
  duration: string;
  languageLabel: string;
  voiceLabel: string;
  next: string;
  stepOf: (n: number) => string;
  howTitle: string;
  howPoints: string[];
  dragHint: string;
  modelAlt: string;
  instructionAlt: string;
  codeTitle: string;
  codeHint: string;
  frameHint: string;
  shutter: string;
  codeChip: string;
  reviewTitle: string;
  reviewChecks: string[];
  sentBody: string;
  cameraTitle: string;
  cameraSteps: string[];
  cameraRetry: string;
  notSentTitle: string;
  photoKept: string;
  startProblemTitle: string;
  openingCamera: string;
  signInTitle: string;
  signInBody: string;
  wrongPatientTitle: string;
  wrongPatientBody: string;
  signOut: string;
  signingOut: string;
  goToPortal: string;
  form: SignInCopy;
};


export const PATIENT_COPY: Record<Language, Copy> = {
  en: {
    welcomeTitle: "Your monthly test, from home",
    welcomeBody:
      "Take your pregnancy test as usual and wait the full time on its box. Then this page helps you photograph it for your clinic.",
    privacy: "We never store your name or ID.",
    duration: "About 2 minutes",
    languageLabel: "Language",
    voiceLabel: "Voice",
    next: "See how it works",
    stepOf: (n) => `Step ${n} of ${STEP_COUNT}`,
    howTitle: "How to photograph your test",
    howPoints: [
      "When you tap Start test, you get a 4-character code.",
      "Write the code on the test with a pen, just right of the window.",
      "Lay the test flat in good light and fit it in the outline on screen.",
    ],
    dragHint: "Drag the test to turn it.",
    modelAlt: "An at-home pregnancy test with a pink cap, lying on a dark surface.",
    instructionAlt:
      "The test seen from above. The code goes in the marked spot just right of the result window.",
    codeTitle: "Write this code on your test",
    codeHint: "Use a pen. Write it on the plastic, just right of the result window.",
    frameHint: "Fit the whole test inside the outline",
    shutter: "Take photo",
    codeChip: "Your code",
    reviewTitle: "Check your photo",
    reviewChecks: ["The result window is sharp", "Your code is easy to read", "The whole test is in the photo"],
    sentBody: "Your doctor will review it and contact you. You can close this page.",
    cameraTitle: "Allow the camera to continue",
    cameraSteps: [
      "iPhone: open Settings, then Safari, then Camera, and choose Allow.",
      "Android: tap the lock icon next to the address, then Permissions, then Camera, and choose Allow.",
      "Then come back and tap Try again.",
    ],
    cameraRetry: "Try again",
    notSentTitle: "Not sent yet",
    photoKept: "Your photo is still here. Tap Try again when you have a connection.",
    startProblemTitle: "Couldn't start",
    openingCamera: "Opening camera…",
    signInTitle: "Sign in to start your test",
    signInBody: "This link only works for the PledgeCheck account it was sent to. Sign in, and your test starts right here.",
    wrongPatientTitle: "This link belongs to a different account",
    wrongPatientBody:
      "You're signed in to a different PledgeCheck account. Sign out, then sign in with the account your clinic sent this link to.",
    signOut: "Sign out",
    signingOut: "Signing out…",
    goToPortal: "Go to your portal",
    form: {
      email: "Email",
      password: "Password",
      submit: "Sign in",
      submitting: "Signing in…",
      badCredentials: "Email or password is incorrect.",
      unreachable: "Could not reach the sign-in service. Check your connection and try again.",
    },
  },
  es: {
    welcomeTitle: "Su prueba mensual, desde casa",
    welcomeBody:
      "Haga su prueba de embarazo como siempre y espere el tiempo completo indicado en la caja. Después, esta página le ayuda a fotografiarla para su clínica.",
    privacy: "Nunca guardamos su nombre ni su identificación.",
    duration: "Unos 2 minutos",
    languageLabel: "Idioma",
    voiceLabel: "Voz",
    next: "Ver cómo funciona",
    stepOf: (n) => `Paso ${n} de ${STEP_COUNT}`,
    howTitle: "Cómo fotografiar su prueba",
    howPoints: [
      "Al tocar Comenzar prueba, recibirá un código de 4 caracteres.",
      "Escriba el código en la prueba con bolígrafo, justo a la derecha de la ventana.",
      "Deje la prueba plana con buena luz y encájela en el contorno de la pantalla.",
    ],
    dragHint: "Arrastre la prueba para girarla.",
    modelAlt: "Una prueba de embarazo casera con tapa rosa, sobre una superficie oscura.",
    instructionAlt:
      "La prueba vista desde arriba. El código va en el espacio marcado, justo a la derecha de la ventana de resultado.",
    codeTitle: "Escriba este código en su prueba",
    codeHint: "Use bolígrafo. Escríbalo en el plástico, justo a la derecha de la ventana de resultado.",
    frameHint: "Encaje toda la prueba dentro del contorno",
    shutter: "Tomar foto",
    codeChip: "Su código",
    reviewTitle: "Revise su foto",
    reviewChecks: ["La ventana de resultado se ve nítida", "Su código se lee con facilidad", "Toda la prueba aparece en la foto"],
    sentBody: "Su médico la revisará y se comunicará con usted. Puede cerrar esta página.",
    cameraTitle: "Permita el uso de la cámara para continuar",
    cameraSteps: [
      "iPhone: abra Ajustes, luego Safari, luego Cámara, y elija Permitir.",
      "Android: toque el candado junto a la dirección, luego Permisos, luego Cámara, y elija Permitir.",
      "Después vuelva y toque Intentar de nuevo.",
    ],
    cameraRetry: "Intentar de nuevo",
    notSentTitle: "Aún no se ha enviado",
    photoKept: "Su foto sigue aquí. Toque Intentar de nuevo cuando tenga conexión.",
    startProblemTitle: "No se pudo comenzar",
    openingCamera: "Abriendo la cámara…",
    signInTitle: "Inicie sesión para comenzar su prueba",
    signInBody:
      "Este enlace solo funciona con la cuenta de PledgeCheck a la que se envió. Inicie sesión y su prueba comenzará aquí mismo.",
    wrongPatientTitle: "Este enlace pertenece a otra cuenta",
    wrongPatientBody:
      "Inició sesión con otra cuenta de PledgeCheck. Cierre sesión y luego inicie sesión con la cuenta a la que su clínica envió este enlace.",
    signOut: "Cerrar sesión",
    signingOut: "Cerrando sesión…",
    goToPortal: "Ir a su portal",
    form: {
      email: "Correo electrónico",
      password: "Contraseña",
      submit: "Iniciar sesión",
      submitting: "Iniciando sesión…",
      badCredentials: "El correo o la contraseña no son correctos.",
      unreachable: "No se pudo conectar con el servicio de inicio de sesión. Revise su conexión e inténtelo de nuevo.",
    },
  },
};
