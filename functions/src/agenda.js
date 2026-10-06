// Agenda da carga na nuvem, cadastrada no portal (Controle de Cargas) em
// config/agenda_nuvem: { ativo, horarios: ["08:30", …], dias: [0-6, 0 = domingo], competencia_inicio }.

// Horário que passou há mais que isso sem disparar (função fora do ar) é pulado.
export const JANELA_MIN = 60;

// Data, minuto do dia e dia da semana agora, no fuso de Brasília.
export function agoraBrasilia(data = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(data)
      .map((p) => [p.type, p.value])
  );
  return {
    data: partes.year + "-" + partes.month + "-" + partes.day,
    minutos: Number(partes.hour) * 60 + Number(partes.minute),
    diaSemana: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(partes.weekday),
  };
}

function emMinutos(horario) {
  const [h, m] = horario.split(":").map(Number);
  return h * 60 + m;
}

// Horários da agenda que já chegaram hoje e ainda não dispararam.
export function horariosVencidos(agenda, agora, jaDisparados) {
  if (!agenda || !agenda.ativo || !agenda.horarios || !agenda.horarios.length) return [];
  const dias = agenda.dias && agenda.dias.length ? agenda.dias : [0, 1, 2, 3, 4, 5, 6];
  if (!dias.includes(agora.diaSemana)) return [];
  return agenda.horarios.filter((h) => {
    const atraso = agora.minutos - emMinutos(h);
    return atraso >= 0 && atraso < JANELA_MIN && !jaDisparados.includes(h);
  });
}
