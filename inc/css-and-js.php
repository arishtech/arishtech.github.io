<?php 
/**
 * Enqueue scripts and styles.
 */
function restly_scripts() {
	global $wp_query;
	wp_enqueue_style('bootstrap', get_theme_file_uri('assets/bootstrap/bootstrap-min.css'), array(),  _S_VERSION, 'all');
	wp_enqueue_style('bootstrap-rtl', get_theme_file_uri('assets/bootstrap/bootstrap-rtl-min.css'), array(),  _S_VERSION, 'all');
	wp_enqueue_style('bootstrap-icons', get_theme_file_uri('assets/bootstrap/bootstrap-icons.css'), array(),  _S_VERSION, 'all');
	wp_enqueue_style('magnific-popup', get_theme_file_uri('assets/popup/magnific-popup.css'), array(), _S_VERSION , 'all');
	wp_enqueue_style('slick', get_theme_file_uri('assets/slick/slick.css'), array(), _S_VERSION , 'all');
	wp_enqueue_style('restly-unitest', get_theme_file_uri('assets/css/unitest.css'), array(), _S_VERSION , 'all');
	wp_enqueue_style('restly-theme', get_theme_file_uri('assets/css/theme.css'), array(), _S_VERSION , 'all');
	wp_enqueue_style('stellarnav-min', get_theme_file_uri('assets/menu/stellarnav-min.css'), array(), _S_VERSION , 'all');
	wp_enqueue_style('fontawesome-all', get_theme_file_uri('assets/css/fontawesome-all.css'), array(),  _S_VERSION , 'all');
	wp_enqueue_style('restly-style', get_stylesheet_uri(), array(), _S_VERSION, 'all');
	wp_style_add_data( 'restly-style', 'rtl', 'replace' );
	if( !class_exists( 'CSF' ) ) {
		wp_enqueue_style( 'restly-default-fonts', '//fonts.googleapis.com/css?family=Nunito:200;0,300;0,400;0,600;0,700;0,800;0,900;1,200;1,300;1,400|Rubik:300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,500;1,600', '', '1.0.0', 'screen' );
	}
	//Enqueue scripts.
	wp_enqueue_script('popper', get_theme_file_uri('assets/bootstrap/popper-min.js'), array(),  _S_VERSION, true);
	wp_enqueue_script('bootstrap', get_theme_file_uri('assets/bootstrap/bootstrap-min.js'), array(), _S_VERSION, true);
	wp_enqueue_script('jquery-magnific-popup', get_theme_file_uri('assets/popup/jquery-magnific-popup-min.js'), array('jquery'), _S_VERSION , true);
	wp_enqueue_script('stellarnav-min', get_theme_file_uri('assets/menu/stellarnav-min.js'), array('jquery'), _S_VERSION , true);
	wp_enqueue_script('slick-min', get_theme_file_uri('assets/slick/slick-min.js'), array(), _S_VERSION , true);
	wp_enqueue_script('restly-theme', get_theme_file_uri('assets/js/theme.js'), array('jquery'), _S_VERSION , true);
	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) {
		wp_enqueue_script( 'comment-reply' );
	}
}
add_action( 'wp_enqueue_scripts', 'restly_scripts' );
?>