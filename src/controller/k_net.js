import { pool_ecommerce } from '../config/db_config';
import { PreparedStatement, VarChar, DateTime, Request } from 'mssql';
import bcrypt from 'bcrypt';
import { Base64 } from "js-base64";
import WhatsappApi from '../lib/whatsapp_api';
import Axios from 'axios';
import moment from 'moment'
import _ from 'lodash';

export async function jatisMessage(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ps = new PreparedStatement(await pool_ecommerce);
  ps.input('userid', VarChar)
  .input('password', VarChar)
  .input('sender', VarChar)
  .input('messageId', VarChar)
  .input('deliverystatus', VarChar)
  .input('datehit', DateTime)
  .input('datereceived', DateTime)
  .prepare(`SELECT orderno
  FROM db_ecommerce.dbo.ecomm_trans_hdr_sgo a
  WHERE a.wa_sent_remark = @messageId`, err => {
    if (err) throw err;
    ps.execute({ messageId: req.query.messageId }, (err, result) => {
      if (err) {
        throw err;
      } else if (!result.recordset) {
        res.status(204).json({ values: null, message: 'Data not found' })
      } else {
        pool_mlm.then(pool => {
          pool.request()
          .input('orderno', result.recordset[0].orderno)
          .input('messageId', req.query.messageId)
          .input('deliverystatus', req.query.deliverystatus)
          .input('datehit', req.query.datehit)
          .input('datereceived', req.query.datereceived)
          .query(`INSERT INTO db_ecommerce.dbo.ecomm_wa_cod_confirm (
            orderno, messageId, deliverystatus, datehit, datereceived)
            VALUES (
            @orderno, @messageId, @deliverystatus,
            @datehit, @datereceived)`, (err, result) => {
            if (err) {
              throw err;
            } else if (!result) {
              res.status(500).send({
                message: 'Whoops! Something went wrong'
              });
            }
            res.status(200);
          })
        })
      }
      return ps.unprepare();
    })
  })
}

// Cronjob functions
export async function deleteKWalletToken(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const transaction = (await pool_ecommerce).transaction();
  transaction.begin(err => {

    const request = new Request(transaction);
    let query = `DELETE FROM ecomm_kwallet_token
    WHERE CONVERT(VARCHAR(10), createdt, 120)
    < CONVERT(VARCHAR(10), GETDATE(), 120)`;

    // rolledback state
    let rolledBack = false;
    transaction.on('rollback', aborted => {
      rolledBack = true
    })

    request.query(query, (err, result) => {
      if (err) {
        if (!rolledBack) {
          transaction.rollback(err => {
            res.json({ message: err });
          })
        }
      } else {
        transaction.commit(err => {
          if (result.rowsAffected > 0) {
            res.json({ message: 'Success' });
          }
        })
      }
    })
  })
}

/**
 * Get latest token
 *
 * @param   {mixed}  req  http request
 * @param   {mixed}  res  http response
 *
 * @return  {void}       Display token in JSON
 */
export function getToken(req, res) {
  // Create new instance from Whatsapp lib
  const api = new WhatsappApi;

  api.getToken().then(result => {
    if (_.isEmpty(result.recordset)) {
      requestToken().then(token => res.json(token))
    } else {
      res.send(result.recordset[0])
    }
  })
}

/**
 * Request new token from Jatis
 *
 * @return  {boolean|object}  return new token
 */
export async function requestToken() {
  // Create new instance from Whatsapp lib
  let api = new WhatsappApi;

  // Create basic token http authorization
  let auth = Base64.encode(`${api.interactive_username}:${api.interactive_userpwd}`);

  // Make request to Jatis
  const result = await Axios.post(`${api.url}/wa/users/login`, {}, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  });

  // Destructuring token from API
  let { token, expires_after } = result.data.users[0];

  // Create new object for token
  let newArr = {
    token: token,
    expire: moment(expires_after).format('YYYY-MM-DD')
  };

  // Check if token request has been successfully created
  if (_.isEmpty(result.data.users[0])) return false;

  // Insert new token to database
  pool_ecommerce.then((pool) => {
    pool.request()
    .input('token', newArr.token)
    .input('expire', newArr.expire)
    .query(`INSERT INTO whatsapp_token (token, expire) VALUES (
    @token, CONVERT(VARCHAR, @expire, 23)
    )`, err => {
      if (err) throw err;
    });
  });

  return newArr;
}

// Dev only
/**
 * Assume inputEncrypted as registerMember
 * and compareEncrypted as login
 *
 * @inputEcrypted
 * User input their plain password. Salt
 * and hash user password input and store it to DB
 *
 * @compareEncrypted
 * User input their plain password. Compare
 * the input and return boolean value.
 * If it's matched return true and vice-versa
 */
export async function inputEncrypted(req, res) {
  bcrypt.genSalt(12, (err, salt) => {
    if (err) return err
    bcrypt.hash(req.body.password, salt, (err, hash) => {
      let encoded = Base64.encode(hash)
      res.json(encoded)
    })
  })
}

export async function compareEncrypted(req, res) {
  const match = await bcrypt.compare(
    req.body.password,
    Base64.decode(req.body.hash)
  )
  Object.entries().length === 0
  if (match) {
    res.send(match)
  }
}